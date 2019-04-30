<script>
	import { onMount } from 'svelte';

	// data stored
	let watchlist_map = [
		{
			'name':'Default',
			'stockList': [{ value: 'AAPL' }, { value: 'MSFT' }, { value: 'SPX' }]
		},
		{
			'name':'Second',
			'stockList': [{ value: 'MSFT' }, { value: 'SPX' }]
		},
		{
			'name':'Third',
			'stockList': [{ value: 'SPX' }]
		},
	];

	let defaultStockList = [{ value: 'AAPL' }, { value: 'MSFT' }, { value: 'SPX' }];


	// data displayed
	let watchlistName = 'Default';
	let stockList = [{ value: 'AAPL' }, { value: 'MSFT' }, { value: 'SPX' }];
	let symbolToAdd = '';
	let autocomplete_result = [];
	
	onMount(() => {
		initWatchlistTable();
	});

	function initWatchlistTable() {
		console.log('init...');
		fetchAllStockDescription();
		fetchAllPrices();
	}

	// may be removed
	function clearSymbol(symbol) {
		let position = symbol.indexOf('/');
		if (position > -1) {
			symbol = symbol.replace('/', '');
		}
		position = symbol.indexOf(':');
		if (position > -1) {
			symbol = symbol.substr(0, position);
		}
		return symbol;
	}

	function updateStockListStored(newStockList) {
		for (let i = 0; i < watchlist_map; i++) {
			if (watchlist_map[i].name === watchlistName) {
				watchlist_map[i].stockList = newStockList;
			}
		}
	}

	async function fetchStockDescription(symbol) {
		const URL = 'https://api.tastyworks.com/symbols/search/' + symbol;
		return fetch(URL)
			.then(res => res.json())
			.then(res => {
				return res.data.items[0].description;
			});
	}

	function fetchAllStockDescription() {
		console.log('fetch description..');
		for (let i = 0; i < stockList.length; i++) {
			let symbol = clearSymbol(stockList[i].value);
			let description = fetchStockDescription(symbol)
				.then(des => {
					stockList[i].description = des;
				});
		}
	}

	async function fetchPricesForStockAt(index) {
		let symbol = clearSymbol(stockList[index].value);
		let res = dxFeed.getQuote(symbol);
		stockList[index].askPrice = res.ask;
		stockList[index].bidPrice = res.bid;
		stockList[index].lastPrice = res.last;
	}

	function fetchAllPrices() {
		for (let i = 0; i < stockList.length; i++) {
			fetchPricesForStockAt(i);
		}
	}

	function handleDeleteSymbol(event, index) {
		stockList.splice(index, 1);
		fetchAllPrices(); //update immediately
	}

	function handleAddSymbol(event, symbol) {
		stockList.push({
			value: symbol
		});
		fetchStockDescription(symbol)
			.then(des => {
				stockList[stockList.length-1].description = des;
			});
		symbolToAdd = '';
	}

	function fetchSymbolsForAutoComplete() {
		if (symbolToAdd.length == 0) {
			autocomplete_result = [];
			return;
		}
		const URL = 'https://api.tastyworks.com/symbols/search/' + symbolToAdd.toUpperCase();
		return fetch(URL)
			.then(res => res.json())
			.then(res => {
				let result = [];
				let items = res.data.items;
				for (let i = 0; i < items.length; i++) {
					result.push(items[i].symbol + ": " + items[i].description);
				}
				autocomplete_result = result;
				console.log(autocomplete_result);
			});
	}

	function handleChangeWatchList(event, newWatchlist) {
		if (watchlistName === newWatchlist.name) {
			return;
		}
		console.log('Store data... ');
		updateStockListStored(stockList);
		
		console.log('Switch to ' + newWatchlist.name)
		watchlistName = newWatchlist.name;
		stockList = newWatchlist.stockList;
		initWatchlistTable();
	}

	function handleAddNewWatchlist(event) {
		let newWatchlist = {
			'name':'new watch list',
			'stockList': defaultStockList
		};
		watchlist_map.push(newWatchlist);
		watchlist_map = watchlist_map;
		handleChangeWatchList(null, newWatchlist);
	}

	function handleDeleteWatchList(event, index) {
		watchlist_map.splice(index, 1);
		watchlist_map = watchlist_map;
	}

	setInterval(fetchAllPrices, 2000);
	setInterval(fetchSymbolsForAutoComplete, 2000);

</script>

<style>
h1 {
	text-align: center;
}

table {
	font-weight: lighter;
	border-collapse: collapse;
	background-color: rgb(34,34,34);
	width: 80%;
	margin: 0 auto;
}

th {
	text-align: center;
	color: white;
	padding: 8px;
	height: 40px;
}
td {
	border-top: 1px solid grey;
	color: white;
	text-align: center;
	padding: 8px;
}

.description {
	width: 300px;
	overflow: hidden;
}

.bidPrice .askPrice .lastPrice {
	width: 150px;
	overflow: hidden;
}

.tableButtons {
	background-color: transparent;
	border: none;
	color: white;
	width: 40px;
}

.tableButtons:hover {
	background-color: white;
	border: none;
	color: black;
	width: 40px;
}

.navBar {
  list-style-type: none;
  margin: 0;
  padding: 0;
  width: 200px;
  background-color: #f1f1f1;

  height: 100%;
  position: fixed;
  z-index: 1;
  top: 0;
  left: 0;
  overflow-x: hidden;
  padding-top: 20px;
}

.navBarButton {
	width: 200px;
	border: none;
	display: block;
	background-color: #f1f1f1;
	color: #000;
	padding: 8px 16px;
	text-decoration: none;
}

.navBarButton:hover {
	background-color: #555;
	color: white;
}

.main {
	margin-left: 200px;
}

</style>

<!-- <button on:click={e => fetchSymbols(e, "s")}>
	test
</button> -->
<ul class="navBar">
	{#each watchlist_map as watchlist, idx}
		<li>
			<button class="navBarButton" on:click={e => {handleChangeWatchList(e, watchlist)}}>{watchlist.name}</button>
			<button class="navBarDeleteButton" on:click={e => handleDeleteWatchList(e, idx)}> ✘ </button>
		</li>
	{/each}
	<li><button class="navBarButton" on:click={e => {handleAddNewWatchlist(e)}}> + Add new watchlist </button></li>
</ul>
<div class="main">
	<h1> {watchlistName} Watchlist</h1>

	<table>
		<tr>
			<th class="symbol">Symbol</th>
			<th class="description">Description</th>
			<th class="bidPrice">Bid Price</th>
			<th class="askPrice">Ask Price</th>
			<th class="lastPrice">Last Price</th>
			<th class="delete">Delete</th>
		</tr>
		
		{#each stockList as stock, idx}
		<tr>
			<td>{stock.value}</td>
			<td>{stock.description || '-'}</td>
			<td>{stock.bidPrice || '-'}</td>
			<td>{stock.askPrice || '-'}</td>
			<td>{stock.lastPrice || '-'}</td>
			<td><button class="tableButtons" on:click={e => handleDeleteSymbol(e, idx)}> ✘ </button></td>
		</tr>
		{/each}
		<tr>
			<td colspan="6">
				<input placeholder="Add symbol" bind:value={symbolToAdd} list="choices">
				<datalist id="choices">
					{#each autocomplete_result as choice}
						<option value={choice} />
					{/each}
				</datalist>
				<button class="tableButtons" on:click={e => handleAddSymbol(e, clearSymbol(symbolToAdd))}> ✔︎ </button>
			</td> 
		</tr>
	</table>
</div>
