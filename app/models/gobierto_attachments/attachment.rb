# frozen_string_literal: true

require_dependency 'gobierto_attachments'

module GobiertoAttachments
  class Attachment < ApplicationRecord
    paginates_per 8

    include User::Subscribable
    include GobiertoCommon::Searchable
    include GobiertoCommon::Sluggable

    MAX_FILE_SIZE_IN_BYTES = 10.megabytes

    default_scope { order(id: :desc) }

    has_paper_trail(
      on:     [:create, :update, :destroy],
      ignore: [:name, :file_size, :file_name, :description, :current_version]
    )

    algoliasearch_gobierto do
      attribute :site_id, :name, :description, :file_name, :url, :file_size
      searchableAttributes ['name', 'description', 'file_name']
      attributesForFaceting [:site_id]
    end

    attr_accessor :file

    validates :site, presence: true

    validates :file_digest, uniqueness: {
      scope: :site_id,
      message: ->(object, data) do
        url = object.site.attachments.find_by!(file_digest: object.file_digest).url
        "#{I18n.t('activerecord.messages.gobierto_attachments/attachment.already_uploaded')} #{url})."
      end
    }

    belongs_to :site

    before_validation :update_file_attributes

    scope :sort_by_updated_at, ->(num) { order(updated_at: :desc).limit(num) }

    def content_type
      MIME::Types.type_for(url).first.content_type
    end

    def collection
      GobiertoCommon::CollectionItem.find_by(item: self, item_type: 'GobiertoAttachments::Attachment').collection
    end

    def self.file_attachments_in_collections(site)
      ids = GobiertoCommon::CollectionItem.where(item_type: 'GobiertoAttachments::Attachment').map(&:item_id)
      where(id: ids, site: site)
    end

    def self.attachments_in_collections_and_container_type(site, container_type)
      ids = GobiertoCommon::CollectionItem.where(item_type: "GobiertoAttachments::Attachment", container_type: container_type).pluck(:item_id)
      where(id: ids, site: site)
    end

    def self.attachments_in_collections_and_container(site, container)
      ids = GobiertoCommon::CollectionItem.where(item_type: "GobiertoAttachments::Attachment", container: container).pluck(:item_id)
      where(id: ids, site: site)
    end

    def self.file_digest(file)
      Digest::MD5.hexdigest(file.read)
    end

    def extension
      File.extname(file_name).tr('.', '')
    end

    def active?
      true
    end

    def created_at
      if versions.length > 0
        versions.last.created_at
      end
    end

    def parameterize
      { slug: slug }
    end

    def attributes_for_slug
      [name]
    end

    private

    def update_file_attributes
      if file
        if file.size > MAX_FILE_SIZE_IN_BYTES
          errors.add(:base, "#{I18n.t('activerecord.messages.gobierto_attachments/attachment.file_too_big')} (#{MAX_FILE_SIZE_IN_BYTES/1024} Mb)")
          throw :abort
        end

        self.file_digest = self.class.file_digest(file.open)

        if file_digest_changed? && unique_file_digest?
          self.file_name = file.original_filename
          self.file_size = file.size
          self.current_version += 1
          self.url = ::GobiertoAdmin::FileUploadService.new(site: site, collection: 'attachments', attribute_name: :attachment, file: file).call
        end

        file.close
      end
    end

    def unique_file_digest?
      attachment_with_same_digest_id = site.attachments.where(file_digest: file_digest).pluck(:id).first
      attachment_with_same_digest_id.nil? || (attachment_with_same_digest_id == id)
    end

  end
end
