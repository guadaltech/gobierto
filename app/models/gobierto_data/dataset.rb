# frozen_string_literal: true

require_dependency "gobierto_data"

module GobiertoData
  class Dataset < ApplicationRecord
    include GobiertoCommon::Sluggable
    include GobiertoData::Favoriteable
    include GobiertoAttachments::Attachable
    include GobiertoCommon::Collectionable

    belongs_to :site
    has_many :queries, dependent: :destroy, class_name: "GobiertoData::Query"
    has_many :visualizations, dependent: :destroy, class_name: "GobiertoData::Visualization"

    scope :sorted, -> { order(data_updated_at: :desc) }

    translates :name

    enum visibility_level: { draft: 0, active: 1 }

    validates :site, :name, :slug, :table_name, presence: true
    validates(
      :table_name,
      format: {
        with: /\A[a-zA-Z_][a-zA-Z0-9_]+\z/,
        message: I18n.t("errors.messages.invalid_table_name")
      },
      length: { maximum: 50 }
    )
    validates :slug, :table_name, uniqueness: { scope: :site_id }

    before_save :set_schema, if: :will_save_change_to_visibility_level?

    def attributes_for_slug
      [name]
    end

    def available_formats
      [:csv, :json, :xlsx]
    end

    def rails_model
      @rails_model ||= begin
                         return unless internal_rails_class_name

                         return Connection.const_get(internal_rails_class_name) if Connection.const_defined?(internal_rails_class_name)

                         db_config = Connection.db_config(site)
                         return if db_config.blank?

                         db_config = db_config.values_at(:read_draft_db_config, :read_db_config).compact.first || db_config

                         Class.new(Connection).tap do |connection_model|
                           Connection.const_set(internal_rails_class_name, connection_model)
                           connection_model.connection.execute("SET search_path TO draft, public")

                           connection_model.establish_connection(db_config)
                           connection_model.table_name = table_name
                         end
                       end
    end

    def columns_stats
      rails_model.columns.inject({}) do |columns, column|
        columns.update(
          column.name => {
            type: column.type,
            stats: scrutinizer.stats(column)
          }
        )
      end
    end

    def load_data_from_file(file_path, schema_file: nil, csv_separator: ",", append: false)
      statements = GobiertoData::Datasets::CreationStatements.new(
        self,
        file_path,
        schema_from_file(schema_file, append),
        csv_separator: csv_separator,
        append: append,
        use_stdin: true
      )

      query_result = Connection.execute_write_query_from_file_using_stdin(site, statements.sql_code, file_path: file_path)
      set_schema
      touch(:data_updated_at) unless query_result.blank? || query_result.has_key?(:errors)
      {
        db_result: query_result,
        schema: statements.schema,
        script: statements.transaction_sql_code
      }
    rescue JSON::ParserError => e
      {
        db_result: { errors: [{ schema: "Malformed file: #{e.message}" }] }
      }
    rescue GobiertoData::SqlFunction::Transformation::UndefinedFunction => e
      {
        db_result: { errors: [{ schema: "Invalid schema: #{e.message}" }] }
      }
    end

    private

    def schema_from_file(schema_file, append)
      if schema_file.blank?
        append ? table_schema : {}
      elsif schema_file.is_a? Hash
        schema_file.deep_symbolize_keys
      else
        JSON.parse(File.read(schema_file)).deep_symbolize_keys
      end
    end

    def table_schema
      table_columns = Connection.execute_query(site, "SELECT column_name, data_type FROM information_schema.COLUMNS WHERE table_name='#{table_name}'", write: true)
      table_columns.inject({}) do |schema, column|
        schema.update(column["column_name"] => { "original_name" => column["column_name"], "type" => column["data_type"] })
      end
    end

    def set_schema
      if draft?
        Connection.execute_query(site, "ALTER TABLE IF EXISTS #{table_name} SET SCHEMA draft", write: true)
      else
        Connection.execute_query(site, "ALTER TABLE IF EXISTS #{table_name} SET SCHEMA public", write: true)
      end
    end

    def internal_rails_class_name
      return unless site.present? && table_name.present?

      @internal_rails_class_name ||= "site_id_#{site.id}_table_#{table_name}".classify
    end

    def scrutinizer
      @scrutinizer ||= GobiertoData::Datasets::Scrutinizer.new(dataset: self)
    end
  end
end
