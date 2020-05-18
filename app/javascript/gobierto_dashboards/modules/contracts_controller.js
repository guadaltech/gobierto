import Vue from "vue";
import VueRouter from "vue-router";

import { sum, mean, median, max } from 'd3-array';
import { scaleThreshold } from 'd3-scale';

const d3 = { scaleThreshold, sum, mean, median, max }

import crossfilter from 'crossfilter2'

import { getRemoteData } from '../webapp/lib/get_remote_data'
import { EventBus } from '../webapp/mixins/event_bus'
import { money } from 'lib/shared'

import { AmountDistributionBars } from "lib/visualizations";
import { GroupPctDistributionBars } from "lib/visualizations";

Vue.use(VueRouter);
Vue.config.productionTip = false;

// Global variables
let data, reduced, ndx, _r, vueApp;

export class ContractsController {
  constructor(options) {
    const selector = "gobierto-dashboards-contracts-app";

    // Mount Vue applications
    const entryPoint = document.getElementById(selector);

    if (entryPoint) {
      const htmlRouterBlock = `
        <keep-alive>
          <router-view :key="$route.fullPath"></router-view>
        </keep-alive>
      `;

      entryPoint.innerHTML = htmlRouterBlock;

      const Home = () => import("../webapp/containers/shared/Home.vue");
      const Summary = () => import("../webapp/containers/summary/Summary.vue");
      const ContractsIndex = () => import("../webapp/containers/contract/ContractsIndex.vue");
      const ContractsShow = () => import("../webapp/containers/contract/ContractsShow.vue");
      const TendersIndex = () => import("../webapp/containers/tender/TendersIndex.vue");
      const TendersShow = () => import("../webapp/containers/tender/TendersShow.vue");

      const router = new VueRouter({
        mode: "history",
        routes: [
          { path: "/dashboards/contratos", component: Home,
            children: [
              { path: "resumen", name: "summary", component: Summary },
              { path: "contratos", name: "contracts_index", component: ContractsIndex },
              { path: "contratos/:id", name: "contracts_show", component: ContractsShow },
              { path: "licitaciones", name: "tenders_index", component: TendersIndex },
              { path: "licitaciones/:id", name: "tenders_show", component: TendersShow },
            ]
          }

        ],
        scrollBehavior() {
          const element = document.getElementById(selector);
          window.scrollTo({ top: element.offsetTop, behavior: "smooth" });
        }
      });

      const baseTitle = document.title;
      router.afterEach(to => {
        // Wait 2 ticks
        Vue.nextTick(() =>
          Vue.nextTick(() => {
            let title = baseTitle;

            if (to.name === "contracts_show" || to.name === "tenders_show") {
              const { item: { title: itemTitle } = {} } = to.params;

              if (itemTitle) {
                title = `${itemTitle}${baseTitle}`;
              }
            }

            document.title = title;
          })
        );
      });

      Promise.all([getRemoteData(options.contractsEndpoint), getRemoteData(options.tendersEndpoint)]).then((rawData) => {
        this.setGlobalVariables(rawData)

        vueApp = new Vue({
          router,
          data: Object.assign(options, data),
        }).$mount(entryPoint);

        EventBus.$on('summary_ready', () => {
          this._renderSummary();
        });
      });
    }
  }

  setGlobalVariables(rawData){
    let contractsData, tendersData;
    [contractsData, tendersData] = rawData;

    const sortByField = (dateField) => {
      return function(a, b){
        const aDate = a[dateField],
              bDate = b[dateField];

        if (aDate == '') {
          return 1;
        }

        if (bDate == '') {
          return -1;
        }

        if ( aDate < bDate ){
          return -1;
        } else if ( aDate > bDate ){
          return 1;
        } else {
          return 0;
        }
      }
    }

    // Contracts precalculations
    _r = {
      domain: [501, 1001, 5001, 10001, 15001],
      range: [0, 1, 2, 3, 4, 5]
    };
    var rangeFormat = d3.scaleThreshold().domain(_r.domain).range(_r.range);

    for(let i = 0; i < contractsData.length; i++){
      const contract = contractsData[i],
            final_amount = (contract.final_amount === '' || contract.final_amount === undefined) ? 0.0 : parseFloat(contract.final_amount);

      contract.final_amount = final_amount;
      contract.range = rangeFormat(+final_amount);
    }

    data = {
      contractsData: contractsData.sort(sortByField('end_date')),
      tendersData: tendersData.sort(sortByField('submission_date')),
    }
  }

  _renderSummary(){
    ndx = crossfilter(data.contractsData);

    this._renderTendersMetricsBox();
    this._renderContractsMetricsBox();

    this._renderByAmountsChart();
    this._renderContractTypeChart();
    this._renderProcessTypeChart();

    this._renderAssigneesTable();
  }

  _refreshData(reducedContractsData){
    reduced = {tendersData: data.tendersData, contractsData: reducedContractsData};

    vueApp.contractsData = reducedContractsData;

    this._renderContractsMetricsBox();
    this._renderAssigneesTable();
  }

  _renderTendersMetricsBox(){
    const _tendersData = this._currentDataSource().tendersData

    // Calculations
    const amountsArray = _tendersData.map(({initial_amount = 0}) => parseFloat(initial_amount) );

    const numberTenders = _tendersData.length;
    const sumTenders = d3.sum(amountsArray);
    const meanTenders = d3.mean(amountsArray);
    const medianTenders = d3.median(amountsArray);

    // Updating the DOM
    document.getElementById("number-tenders").innerText = numberTenders.toLocaleString();
    document.getElementById("sum-tenders").innerText = money(sumTenders);
    document.getElementById("mean-tenders").innerText = money(meanTenders);
    document.getElementById("median-tenders").innerText = money(medianTenders);
  }

  _renderContractsMetricsBox(){
    const _contractsData = this._currentDataSource().contractsData
    // Calculations
    const amountsArray = _contractsData.map(({final_amount = 0}) => parseFloat(final_amount) );
    const sortedAmountsArray = amountsArray.sort((a, b) => b - a);
    const savingsArray = _contractsData.map(({initial_amount = 0, final_amount = 0}) =>{
      initial_amount = initial_amount === '' ? 0.0 : initial_amount;
      final_amount = final_amount === '' ? 0.0 : final_amount;

      return (1 - parseFloat(final_amount) / parseFloat(initial_amount))
    });

    // Calculations box items
    const numberContracts = _contractsData.length;
    const sumContracts = d3.sum(amountsArray);
    const meanContracts = d3.mean(amountsArray);
    const medianContracts = d3.median(amountsArray);
    const meanSavings = d3.mean(savingsArray);

    // Calculations headlines
    const lessThan1000Total = _contractsData.filter(({final_amount = 0}) => parseFloat(final_amount) < 1000).length;
    const lessThan1000Pct = lessThan1000Total/numberContracts;

    const largerContractAmount = d3.max(_contractsData, ({final_amount = 0}) => parseFloat(final_amount));
    const largerContractAmountPct = largerContractAmount / sumContracts;

    let iteratorAmountsSum = 0, numberContractsHalfSpendings = 0;
    for(let i= 0; i < sortedAmountsArray.length; i++){
      iteratorAmountsSum += sortedAmountsArray[i];
      numberContractsHalfSpendings++;

      if (iteratorAmountsSum > (sumContracts/2) ) { break; }
    }
    const halfSpendingsContractsPct = numberContractsHalfSpendings / numberContracts;

    // Updating the DOM
    document.getElementById("number-contracts").innerText = numberContracts.toLocaleString();
    document.getElementById("sum-contracts").innerText = money(sumContracts);
    document.getElementById("mean-contracts").innerText = money(meanContracts);
    document.getElementById("median-contracts").innerText = money(medianContracts);

    document.getElementById("mean-savings").innerText = meanSavings.toLocaleString(I18n.locale, {
      style: 'percent',
      minimumFractionDigits: 2
    });
    document.getElementById("less-than-1000-pct").innerText = lessThan1000Pct.toLocaleString(I18n.locale, {
      style: 'percent'
    });
    document.getElementById("larger-contract-amount-pct").innerText = largerContractAmountPct.toLocaleString(I18n.locale, {
      style: 'percent'
    });
    document.getElementById("half-spendings-contracts-pct").innerText = halfSpendingsContractsPct.toLocaleString(I18n.locale, {
      style: 'percent'
    });;
  }

  _renderByAmountsChart(){
    const dimension = ndx.dimension(contract => contract.range);

    const renderOptions = {
      containerSelector: "#amount-distribution-bars",
      dimension: dimension,
      range: _r,
      labelMore: I18n.t('gobierto_dashboards.dashboards.contracts.more'),
      labelFromTo: I18n.t('gobierto_dashboards.dashboards.contracts.fromto'),
      onFilteredFunction: () => this._refreshData(dimension.top(Infinity))
    }

    new AmountDistributionBars(renderOptions);
  }

  _renderContractTypeChart(){
    const dimension = ndx.dimension(contract => contract.contract_type)

    const renderOptions = {
      containerSelector: "#contract-type-bars",
      dimension: dimension,
      onFilteredFunction: () => this._refreshData(dimension.top(Infinity))
    }

    new GroupPctDistributionBars(renderOptions);
  }

  _renderProcessTypeChart(){
    const dimension = ndx.dimension(contract => contract.process_type)

    const renderOptions = {
      containerSelector: "#process-type-bars",
      dimension: dimension,
      onFilteredFunction: () => this._refreshData(dimension.top(Infinity))
    }

    new GroupPctDistributionBars(renderOptions);
  }

  _renderAssigneesTable(){
    const _contractsData = this._currentDataSource().contractsData,
          table = document.getElementById("assignees-table"),
          cellClass = "dashboards-home-main--td",
          groupedByAssignee = {};

    // Group contracts by assignee
    _contractsData.forEach((contract) => {
      if (contract.assignee === '' || contract.assignee === undefined) {
        return;
      }

      groupedByAssignee[contract.assignee] = groupedByAssignee[contract.assignee] || {name: contract.assignee}

      groupedByAssignee[contract.assignee].sum = groupedByAssignee[contract.assignee].sum || 0
      groupedByAssignee[contract.assignee].sum += parseFloat(contract.final_amount)

      groupedByAssignee[contract.assignee].count = groupedByAssignee[contract.assignee].count || 0
      groupedByAssignee[contract.assignee].count++;
    });


    // Sort grouped elements by number of contracts
    const sortedAndGrouped = Object.values(groupedByAssignee).sort((a, b) => { return a.count > b.count ? 1 : -1 });

    // If the table already has content we remove it
    if (table.rows.length > 0) {
      for (var i = table.rows.length - 1; i >= 0; i--) {
        table.deleteRow(i);
      }
    }

    // Build the table
    sortedAndGrouped.forEach((groupedItem) => {
      const row = table.insertRow(0);

      const cellAssignee = row.insertCell(0);
      const cellContracts = row.insertCell(1);
      const cellAmountSum = row.insertCell(2);

      cellAssignee.classList.add(cellClass);
      cellContracts.classList.add(cellClass);
      cellAmountSum.classList.add(cellClass);

      cellAssignee.innerHTML = groupedItem.name;
      cellContracts.innerHTML = groupedItem.count;
      cellAmountSum.innerHTML = money(groupedItem.sum);
    })
  }

  _currentDataSource(){
    return reduced || data
  }
}

