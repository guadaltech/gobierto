<template>
  <Loading
    v-if="isFetchingData"
    :message="labelLoading"
  />
  <div v-else>
    <Header :options="options">
      <template v-for="{ key, length } in summary">
        <NumberLabel
          :key="key"
          :length="length"
          :level="key"
        />
      </template>
    </Header>

    <ButtonFilters :options="options" />

    <router-view
      :json="json"
      :options="options"
    />
  </div>
</template>

<script>
import Header from "./components/Header.vue";
import NumberLabel from "./components/NumberLabel.vue";
import ButtonFilters from "./components/ButtonFilters.vue";
import { PlansFactoryMixin } from "./lib/factory";
import { groupBy } from "./lib/helpers";
import { PlansStore } from "./lib/store";
import { Loading } from "lib/vue-components";

export default {
  name: "Main",
  components: {
    Header,
    NumberLabel,
    ButtonFilters,
    Loading
  },
  mixins: [PlansFactoryMixin],
  data() {
    return {
      json: [],
      options: {},
      summary: [],
      isFetchingData: true,
      labelLoading: I18n.t("gobierto_plans.plan_types.show.loading") || ""
    };
  },
  async created() {
    const PLAN_ID = this.$root.$data.planId;

    const [
      { data: { data: plan } = {} } = {},
      { data: { data: projects } = {} } = {},
      { data: { data: meta } = {} } = {}
    ] = await Promise.all([
      this.getPlan(PLAN_ID),
      this.getProjects(PLAN_ID),
      this.getMeta(PLAN_ID)
    ]);

    const {
      attributes: {
        configuration_data: options = {},
        categories_vocabulary_terms: categories,
        statuses_vocabulary_terms: status
      }
    } = plan;

    PlansStore.setProjects(projects);
    PlansStore.setPlainItems([...categories, ...projects]);
    PlansStore.setMeta(meta);
    PlansStore.setStatus(status);

    const {
      last_level,
      summary,
      json,
      progress,
      max_category_level
    } = this.setJsonTree(categories, projects);

    this.json = json;
    this.summary = summary;
    options.last_level = last_level;
    options.global_progress = progress;
    options.max_category_level = max_category_level;

    this.options = options;
    PlansStore.setOptions(options);

    // set this flag at the end, once every calc has been done
    this.isFetchingData = false;

    // this cannot be done in the recursiveTree function since
    // it's declared in a reverse way, from the projects to the root
    // however, to insert the rootid has to be done from root to projects
    for (let index = 0; index < this.json.length; index++) {
      this.json[index] = this.setRootId(this.json[index], index);
    }
  },
  methods: {
    setJsonTree(categories, projects) {
      // for simplicity to groupby
      const categoriesWithLevel = categories.map(d => ({
        ...d,
        level: d.attributes.level
      }));
      // get the deepest category level, plus one to set the project level
      const lastLevel =
        Math.max(...categoriesWithLevel.map(({ level }) => level)) + 1;
      // populate the projects with another extra level, its progress, and the number of projects (always 1)
      const projectsWithLevel = projects.map(d => ({
        ...d,
        level: lastLevel,
        progress: d.attributes.progress,
        projects: 1
      }));
      // merge both arrays
      const data = [...categoriesWithLevel, ...projectsWithLevel];
      // group them by level
      const agg = groupBy(data, "level");
      // get the keys
      const keys = Object.keys(agg);
      // creates a summary with the amounts of items by category
      const summary = keys.map(a => ({ key: +a, length: agg[a].length }));

      // From a plain array, creates the required JSON structure
      // nesting their children inside each category
      const setRecursiveTree = (data, i) => [
        ...data.filter(({ level }) => level < i),
        ...data.reduce((acc, item) => {
          if (item.level === i) {
            /**
             * calculate which are their children based on its level
             * project: no children
             * last-category: count category_id
             * others: count term_id
             */
            const children =
              item.level === lastLevel
                ? null
                : item.level === lastLevel - 1
                ? data.filter(
                    ({ attributes: { category_id } = {} }) =>
                      +item.id === category_id
                  )
                : data.filter(
                    ({ attributes: { term_id } = {} }) => +item.id === term_id
                  );

            /**
             * calculate the number of projects a category has
             * project: itself. Just one.
             * last-category: their children
             * others: concat all the projects their children have
             */
            const itemProjects =
              item.level === lastLevel
                ? 1
                : item.level === lastLevel - 1
                ? children
                : children.reduce((acc, { projects }) => [...acc, ...projects], [])

            /**
             * calculate which are its progress
             * project: get the attribute progress
             * others: arithmethic mean of their children projects
             */
            const progress =
              item.level === lastLevel
                ? item.attributes.progress
                : this.meanByProgress(itemProjects);

            acc.push({
              ...item,
              progress,
              ...(children && { children }),
              ...(itemProjects !== undefined && { projects: itemProjects })
            });
          }
          return acc;
        }, [])
      ];

      let dataParsed = data;
      // note the FOR-loop is inversed
      for (let index = keys.length; index--; ) {
        dataParsed = setRecursiveTree(dataParsed, index);
      }

      return {
        last_level: lastLevel,
        max_category_level: lastLevel - 1,
        summary,
        json: dataParsed,
        progress: this.meanByProgress(projectsWithLevel)
      };
    },
    meanByProgress(data) {
      if (!data.length) return 0;

      const sum = data.reduce((acc, { progress }) => acc + progress, 0);
      const total = data.reduce((acc, { projects }) => acc + projects, 0);

      return total === 0 ? 0 : sum / total;
    },
    setRootId(item, ix) {
      if ((item.children || []).length) {
        item.children = item.children.map(x => this.setRootId(x, ix));
      }
      return { ...item, rootid: ix };
    }
  }
};
</script>
