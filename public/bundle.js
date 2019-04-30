var app = (function () {
	'use strict';

	function noop() {}

	function add_location(element, file, line, column, char) {
		element.__svelte_meta = {
			loc: { file, line, column, char }
		};
	}

	function run(fn) {
		return fn();
	}

	function blank_object() {
		return Object.create(null);
	}

	function run_all(fns) {
		fns.forEach(run);
	}

	function is_function(thing) {
		return typeof thing === 'function';
	}

	function safe_not_equal(a, b) {
		return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
	}

	function append(target, node) {
		target.appendChild(node);
	}

	function insert(target, node, anchor) {
		target.insertBefore(node, anchor);
	}

	function detach(node) {
		node.parentNode.removeChild(node);
	}

	function destroy_each(iterations, detaching) {
		for (let i = 0; i < iterations.length; i += 1) {
			if (iterations[i]) iterations[i].d(detaching);
		}
	}

	function element(name) {
		return document.createElement(name);
	}

	function text(data) {
		return document.createTextNode(data);
	}

	function space() {
		return text(' ');
	}

	function listen(node, event, handler, options) {
		node.addEventListener(event, handler, options);
		return () => node.removeEventListener(event, handler, options);
	}

	function attr(node, attribute, value) {
		if (value == null) node.removeAttribute(attribute);
		else node.setAttribute(attribute, value);
	}

	function children(element) {
		return Array.from(element.childNodes);
	}

	function set_data(text, data) {
		data = '' + data;
		if (text.data !== data) text.data = data;
	}

	let current_component;

	function set_current_component(component) {
		current_component = component;
	}

	function get_current_component() {
		if (!current_component) throw new Error(`Function called outside component initialization`);
		return current_component;
	}

	function onMount(fn) {
		get_current_component().$$.on_mount.push(fn);
	}

	const dirty_components = [];

	let update_promise;
	const binding_callbacks = [];
	const render_callbacks = [];
	const flush_callbacks = [];

	function schedule_update() {
		if (!update_promise) {
			update_promise = Promise.resolve();
			update_promise.then(flush);
		}
	}

	function add_render_callback(fn) {
		render_callbacks.push(fn);
	}

	function flush() {
		const seen_callbacks = new Set();

		do {
			// first, call beforeUpdate functions
			// and update components
			while (dirty_components.length) {
				const component = dirty_components.shift();
				set_current_component(component);
				update(component.$$);
			}

			while (binding_callbacks.length) binding_callbacks.shift()();

			// then, once components are updated, call
			// afterUpdate functions. This may cause
			// subsequent updates...
			while (render_callbacks.length) {
				const callback = render_callbacks.pop();
				if (!seen_callbacks.has(callback)) {
					callback();

					// ...so guard against infinite loops
					seen_callbacks.add(callback);
				}
			}
		} while (dirty_components.length);

		while (flush_callbacks.length) {
			flush_callbacks.pop()();
		}

		update_promise = null;
	}

	function update($$) {
		if ($$.fragment) {
			$$.update($$.dirty);
			run_all($$.before_render);
			$$.fragment.p($$.dirty, $$.ctx);
			$$.dirty = null;

			$$.after_render.forEach(add_render_callback);
		}
	}

	function mount_component(component, target, anchor) {
		const { fragment, on_mount, on_destroy, after_render } = component.$$;

		fragment.m(target, anchor);

		// onMount happens after the initial afterUpdate. Because
		// afterUpdate callbacks happen in reverse order (inner first)
		// we schedule onMount callbacks before afterUpdate callbacks
		add_render_callback(() => {
			const new_on_destroy = on_mount.map(run).filter(is_function);
			if (on_destroy) {
				on_destroy.push(...new_on_destroy);
			} else {
				// Edge case - component was destroyed immediately,
				// most likely as a result of a binding initialising
				run_all(new_on_destroy);
			}
			component.$$.on_mount = [];
		});

		after_render.forEach(add_render_callback);
	}

	function destroy(component, detaching) {
		if (component.$$) {
			run_all(component.$$.on_destroy);
			component.$$.fragment.d(detaching);

			// TODO null out other refs, including component.$$ (but need to
			// preserve final state?)
			component.$$.on_destroy = component.$$.fragment = null;
			component.$$.ctx = {};
		}
	}

	function make_dirty(component, key) {
		if (!component.$$.dirty) {
			dirty_components.push(component);
			schedule_update();
			component.$$.dirty = {};
		}
		component.$$.dirty[key] = true;
	}

	function init(component, options, instance, create_fragment, not_equal$$1, prop_names) {
		const parent_component = current_component;
		set_current_component(component);

		const props = options.props || {};

		const $$ = component.$$ = {
			fragment: null,
			ctx: null,

			// state
			props: prop_names,
			update: noop,
			not_equal: not_equal$$1,
			bound: blank_object(),

			// lifecycle
			on_mount: [],
			on_destroy: [],
			before_render: [],
			after_render: [],
			context: new Map(parent_component ? parent_component.$$.context : []),

			// everything else
			callbacks: blank_object(),
			dirty: null
		};

		let ready = false;

		$$.ctx = instance
			? instance(component, props, (key, value) => {
				if ($$.ctx && not_equal$$1($$.ctx[key], $$.ctx[key] = value)) {
					if ($$.bound[key]) $$.bound[key](value);
					if (ready) make_dirty(component, key);
				}
			})
			: props;

		$$.update();
		ready = true;
		run_all($$.before_render);
		$$.fragment = create_fragment($$.ctx);

		if (options.target) {
			if (options.hydrate) {
				$$.fragment.l(children(options.target));
			} else {
				$$.fragment.c();
			}

			if (options.intro && component.$$.fragment.i) component.$$.fragment.i();
			mount_component(component, options.target, options.anchor);
			flush();
		}

		set_current_component(parent_component);
	}

	class SvelteComponent {
		$destroy() {
			destroy(this, true);
			this.$destroy = noop;
		}

		$on(type, callback) {
			const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
			callbacks.push(callback);

			return () => {
				const index = callbacks.indexOf(callback);
				if (index !== -1) callbacks.splice(index, 1);
			};
		}

		$set() {
			// overridden by instance, if it has props
		}
	}

	class SvelteComponentDev extends SvelteComponent {
		constructor(options) {
			if (!options || (!options.target && !options.$$inline)) {
				throw new Error(`'target' is a required option`);
			}

			super();
		}

		$destroy() {
			super.$destroy();
			this.$destroy = () => {
				console.warn(`Component was already destroyed`); // eslint-disable-line no-console
			};
		}
	}

	/* src/App.svelte generated by Svelte v3.0.0 */

	const file = "src/App.svelte";

	function get_each_context(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.choice = list[i];
		return child_ctx;
	}

	function get_each_context_1(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.stock = list[i];
		child_ctx.idx = i;
		return child_ctx;
	}

	function get_each_context_2(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.watchlist = list[i];
		child_ctx.idx = i;
		return child_ctx;
	}

	// (253:1) {#each watchlist_map as watchlist, idx}
	function create_each_block_2(ctx) {
		var li, button0, t0_value = ctx.watchlist.name, t0, t1, button1, dispose;

		function click_handler(...args) {
			return ctx.click_handler(ctx, ...args);
		}

		function click_handler_1(...args) {
			return ctx.click_handler_1(ctx, ...args);
		}

		return {
			c: function create() {
				li = element("li");
				button0 = element("button");
				t0 = text(t0_value);
				t1 = space();
				button1 = element("button");
				button1.textContent = "✘";
				button0.className = "navBarButton svelte-521g9e";
				add_location(button0, file, 254, 3, 5072);
				button1.className = "navBarDeleteButton";
				add_location(button1, file, 255, 3, 5184);
				add_location(li, file, 253, 2, 5064);

				dispose = [
					listen(button0, "click", click_handler),
					listen(button1, "click", click_handler_1)
				];
			},

			m: function mount(target, anchor) {
				insert(target, li, anchor);
				append(li, button0);
				append(button0, t0);
				append(li, t1);
				append(li, button1);
			},

			p: function update(changed, new_ctx) {
				ctx = new_ctx;
				if ((changed.watchlist_map) && t0_value !== (t0_value = ctx.watchlist.name)) {
					set_data(t0, t0_value);
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(li);
				}

				run_all(dispose);
			}
		};
	}

	// (274:2) {#each stockList as stock, idx}
	function create_each_block_1(ctx) {
		var tr, td0, t0_value = ctx.stock.value, t0, t1, td1, t2_value = ctx.stock.description || '-', t2, t3, td2, t4_value = ctx.stock.bidPrice || '-', t4, t5, td3, t6_value = ctx.stock.askPrice || '-', t6, t7, td4, t8_value = ctx.stock.lastPrice || '-', t8, t9, td5, button, dispose;

		function click_handler_3(...args) {
			return ctx.click_handler_3(ctx, ...args);
		}

		return {
			c: function create() {
				tr = element("tr");
				td0 = element("td");
				t0 = text(t0_value);
				t1 = space();
				td1 = element("td");
				t2 = text(t2_value);
				t3 = space();
				td2 = element("td");
				t4 = text(t4_value);
				t5 = space();
				td3 = element("td");
				t6 = text(t6_value);
				t7 = space();
				td4 = element("td");
				t8 = text(t8_value);
				t9 = space();
				td5 = element("td");
				button = element("button");
				button.textContent = "✘";
				td0.className = "svelte-521g9e";
				add_location(td0, file, 275, 3, 5773);
				td1.className = "svelte-521g9e";
				add_location(td1, file, 276, 3, 5799);
				td2.className = "svelte-521g9e";
				add_location(td2, file, 277, 3, 5838);
				td3.className = "svelte-521g9e";
				add_location(td3, file, 278, 3, 5874);
				td4.className = "svelte-521g9e";
				add_location(td4, file, 279, 3, 5910);
				button.className = "tableButtons svelte-521g9e";
				add_location(button, file, 280, 7, 5951);
				td5.className = "svelte-521g9e";
				add_location(td5, file, 280, 3, 5947);
				add_location(tr, file, 274, 2, 5765);
				dispose = listen(button, "click", click_handler_3);
			},

			m: function mount(target, anchor) {
				insert(target, tr, anchor);
				append(tr, td0);
				append(td0, t0);
				append(tr, t1);
				append(tr, td1);
				append(td1, t2);
				append(tr, t3);
				append(tr, td2);
				append(td2, t4);
				append(tr, t5);
				append(tr, td3);
				append(td3, t6);
				append(tr, t7);
				append(tr, td4);
				append(td4, t8);
				append(tr, t9);
				append(tr, td5);
				append(td5, button);
			},

			p: function update(changed, new_ctx) {
				ctx = new_ctx;
				if ((changed.stockList) && t0_value !== (t0_value = ctx.stock.value)) {
					set_data(t0, t0_value);
				}

				if ((changed.stockList) && t2_value !== (t2_value = ctx.stock.description || '-')) {
					set_data(t2, t2_value);
				}

				if ((changed.stockList) && t4_value !== (t4_value = ctx.stock.bidPrice || '-')) {
					set_data(t4, t4_value);
				}

				if ((changed.stockList) && t6_value !== (t6_value = ctx.stock.askPrice || '-')) {
					set_data(t6, t6_value);
				}

				if ((changed.stockList) && t8_value !== (t8_value = ctx.stock.lastPrice || '-')) {
					set_data(t8, t8_value);
				}
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(tr);
				}

				dispose();
			}
		};
	}

	// (288:5) {#each autocomplete_result as choice}
	function create_each_block(ctx) {
		var option, option_value_value;

		return {
			c: function create() {
				option = element("option");
				option.__value = option_value_value = ctx.choice;
				option.value = option.__value;
				add_location(option, file, 288, 6, 6240);
			},

			m: function mount(target, anchor) {
				insert(target, option, anchor);
			},

			p: function update(changed, ctx) {
				if ((changed.autocomplete_result) && option_value_value !== (option_value_value = ctx.choice)) {
					option.__value = option_value_value;
				}

				option.value = option.__value;
			},

			d: function destroy(detaching) {
				if (detaching) {
					detach(option);
				}
			}
		};
	}

	function create_fragment(ctx) {
		var ul, t0, li, button0, t2, div, h1, t3, t4, t5, table, tr0, th0, t7, th1, t9, th2, t11, th3, t13, th4, t15, th5, t17, t18, tr1, td, input, t19, datalist, t20, button1, dispose;

		var each_value_2 = ctx.watchlist_map;

		var each_blocks_2 = [];

		for (var i = 0; i < each_value_2.length; i += 1) {
			each_blocks_2[i] = create_each_block_2(get_each_context_2(ctx, each_value_2, i));
		}

		var each_value_1 = ctx.stockList;

		var each_blocks_1 = [];

		for (var i = 0; i < each_value_1.length; i += 1) {
			each_blocks_1[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
		}

		var each_value = ctx.autocomplete_result;

		var each_blocks = [];

		for (var i = 0; i < each_value.length; i += 1) {
			each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
		}

		return {
			c: function create() {
				ul = element("ul");

				for (var i = 0; i < each_blocks_2.length; i += 1) {
					each_blocks_2[i].c();
				}

				t0 = space();
				li = element("li");
				button0 = element("button");
				button0.textContent = "+ Add new watchlist";
				t2 = space();
				div = element("div");
				h1 = element("h1");
				t3 = text(ctx.watchlistName);
				t4 = text(" Watchlist");
				t5 = space();
				table = element("table");
				tr0 = element("tr");
				th0 = element("th");
				th0.textContent = "Symbol";
				t7 = space();
				th1 = element("th");
				th1.textContent = "Description";
				t9 = space();
				th2 = element("th");
				th2.textContent = "Bid Price";
				t11 = space();
				th3 = element("th");
				th3.textContent = "Ask Price";
				t13 = space();
				th4 = element("th");
				th4.textContent = "Last Price";
				t15 = space();
				th5 = element("th");
				th5.textContent = "Delete";
				t17 = space();

				for (var i = 0; i < each_blocks_1.length; i += 1) {
					each_blocks_1[i].c();
				}

				t18 = space();
				tr1 = element("tr");
				td = element("td");
				input = element("input");
				t19 = space();
				datalist = element("datalist");

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}

				t20 = space();
				button1 = element("button");
				button1.textContent = "✔︎";
				button0.className = "navBarButton svelte-521g9e";
				add_location(button0, file, 258, 5, 5300);
				add_location(li, file, 258, 1, 5296);
				ul.className = "navBar svelte-521g9e";
				add_location(ul, file, 251, 0, 5001);
				h1.className = "svelte-521g9e";
				add_location(h1, file, 261, 1, 5434);
				th0.className = "symbol svelte-521g9e";
				add_location(th0, file, 265, 3, 5490);
				th1.className = "description svelte-521g9e";
				add_location(th1, file, 266, 3, 5524);
				th2.className = "bidPrice svelte-521g9e";
				add_location(th2, file, 267, 3, 5568);
				th3.className = "askPrice svelte-521g9e";
				add_location(th3, file, 268, 3, 5607);
				th4.className = "lastPrice svelte-521g9e";
				add_location(th4, file, 269, 3, 5646);
				th5.className = "delete svelte-521g9e";
				add_location(th5, file, 270, 3, 5687);
				add_location(tr0, file, 264, 2, 5482);
				input.placeholder = "Add symbol";
				attr(input, "list", "choices");
				add_location(input, file, 285, 4, 6090);
				datalist.id = "choices";
				add_location(datalist, file, 286, 4, 6167);
				button1.className = "tableButtons svelte-521g9e";
				add_location(button1, file, 291, 4, 6299);
				td.colSpan = "6";
				td.className = "svelte-521g9e";
				add_location(td, file, 284, 3, 6069);
				add_location(tr1, file, 283, 2, 6061);
				table.className = "svelte-521g9e";
				add_location(table, file, 263, 1, 5472);
				div.className = "main svelte-521g9e";
				add_location(div, file, 260, 0, 5414);

				dispose = [
					listen(button0, "click", ctx.click_handler_2),
					listen(input, "input", ctx.input_input_handler),
					listen(button1, "click", ctx.click_handler_4)
				];
			},

			l: function claim(nodes) {
				throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
			},

			m: function mount(target, anchor) {
				insert(target, ul, anchor);

				for (var i = 0; i < each_blocks_2.length; i += 1) {
					each_blocks_2[i].m(ul, null);
				}

				append(ul, t0);
				append(ul, li);
				append(li, button0);
				insert(target, t2, anchor);
				insert(target, div, anchor);
				append(div, h1);
				append(h1, t3);
				append(h1, t4);
				append(div, t5);
				append(div, table);
				append(table, tr0);
				append(tr0, th0);
				append(tr0, t7);
				append(tr0, th1);
				append(tr0, t9);
				append(tr0, th2);
				append(tr0, t11);
				append(tr0, th3);
				append(tr0, t13);
				append(tr0, th4);
				append(tr0, t15);
				append(tr0, th5);
				append(table, t17);

				for (var i = 0; i < each_blocks_1.length; i += 1) {
					each_blocks_1[i].m(table, null);
				}

				append(table, t18);
				append(table, tr1);
				append(tr1, td);
				append(td, input);

				input.value = ctx.symbolToAdd;

				append(td, t19);
				append(td, datalist);

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(datalist, null);
				}

				append(td, t20);
				append(td, button1);
			},

			p: function update(changed, ctx) {
				if (changed.watchlist_map) {
					each_value_2 = ctx.watchlist_map;

					for (var i = 0; i < each_value_2.length; i += 1) {
						const child_ctx = get_each_context_2(ctx, each_value_2, i);

						if (each_blocks_2[i]) {
							each_blocks_2[i].p(changed, child_ctx);
						} else {
							each_blocks_2[i] = create_each_block_2(child_ctx);
							each_blocks_2[i].c();
							each_blocks_2[i].m(ul, t0);
						}
					}

					for (; i < each_blocks_2.length; i += 1) {
						each_blocks_2[i].d(1);
					}
					each_blocks_2.length = each_value_2.length;
				}

				if (changed.watchlistName) {
					set_data(t3, ctx.watchlistName);
				}

				if (changed.stockList) {
					each_value_1 = ctx.stockList;

					for (var i = 0; i < each_value_1.length; i += 1) {
						const child_ctx = get_each_context_1(ctx, each_value_1, i);

						if (each_blocks_1[i]) {
							each_blocks_1[i].p(changed, child_ctx);
						} else {
							each_blocks_1[i] = create_each_block_1(child_ctx);
							each_blocks_1[i].c();
							each_blocks_1[i].m(table, t18);
						}
					}

					for (; i < each_blocks_1.length; i += 1) {
						each_blocks_1[i].d(1);
					}
					each_blocks_1.length = each_value_1.length;
				}

				if (changed.symbolToAdd) input.value = ctx.symbolToAdd;

				if (changed.autocomplete_result) {
					each_value = ctx.autocomplete_result;

					for (var i = 0; i < each_value.length; i += 1) {
						const child_ctx = get_each_context(ctx, each_value, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
						} else {
							each_blocks[i] = create_each_block(child_ctx);
							each_blocks[i].c();
							each_blocks[i].m(datalist, null);
						}
					}

					for (; i < each_blocks.length; i += 1) {
						each_blocks[i].d(1);
					}
					each_blocks.length = each_value.length;
				}
			},

			i: noop,
			o: noop,

			d: function destroy(detaching) {
				if (detaching) {
					detach(ul);
				}

				destroy_each(each_blocks_2, detaching);

				if (detaching) {
					detach(t2);
					detach(div);
				}

				destroy_each(each_blocks_1, detaching);

				destroy_each(each_blocks, detaching);

				run_all(dispose);
			}
		};
	}

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

	async function fetchStockDescription(symbol) {
		const URL = 'https://api.tastyworks.com/symbols/search/' + symbol;
		return fetch(URL)
			.then(res => res.json())
			.then(res => {
				return res.data.items[0].description;
			});
	}

	function instance($$self, $$props, $$invalidate) {
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

		function updateStockListStored(newStockList) {
			for (let i = 0; i < watchlist_map; i++) {
				if (watchlist_map[i].name === watchlistName) {
					watchlist_map[i].stockList = newStockList; $$invalidate('watchlist_map', watchlist_map);
				}
			}
		}

		function fetchAllStockDescription() {
			console.log('fetch description..');
			for (let i = 0; i < stockList.length; i++) {
				let symbol = clearSymbol(stockList[i].value);
				let description = fetchStockDescription(symbol)
					.then(des => {
						stockList[i].description = des; $$invalidate('stockList', stockList);
					});
			}
		}

		async function fetchPricesForStockAt(index) {
			let symbol = clearSymbol(stockList[index].value);
			let res = dxFeed.getQuote(symbol);
			stockList[index].askPrice = res.ask; $$invalidate('stockList', stockList);
			stockList[index].bidPrice = res.bid; $$invalidate('stockList', stockList);
			stockList[index].lastPrice = res.last; $$invalidate('stockList', stockList);
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
					stockList[stockList.length-1].description = des; $$invalidate('stockList', stockList);
				});
			$$invalidate('symbolToAdd', symbolToAdd = '');
		}

		function fetchSymbolsForAutoComplete() {
			if (symbolToAdd.length == 0) {
				$$invalidate('autocomplete_result', autocomplete_result = []);
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
					$$invalidate('autocomplete_result', autocomplete_result = result);
					console.log(autocomplete_result);
				});
		}

		function handleChangeWatchList(event, newWatchlist) {
			if (watchlistName === newWatchlist.name) {
				return;
			}
			console.log('Store data... ');
			updateStockListStored(stockList);
			
			console.log('Switch to ' + newWatchlist.name);
			$$invalidate('watchlistName', watchlistName = newWatchlist.name);
			$$invalidate('stockList', stockList = newWatchlist.stockList);
			initWatchlistTable();
		}

		function handleAddNewWatchlist(event) {
			let newWatchlist = {
				'name':'new watch list',
				'stockList': defaultStockList
			};
			watchlist_map.push(newWatchlist);
			$$invalidate('watchlist_map', watchlist_map);
			handleChangeWatchList(null, newWatchlist);
		}

		function handleDeleteWatchList(event, index) {
			watchlist_map.splice(index, 1);
			$$invalidate('watchlist_map', watchlist_map);
		}

		setInterval(fetchAllPrices, 2000);
		setInterval(fetchSymbolsForAutoComplete, 2000);

		function click_handler({ watchlist }, e) {handleChangeWatchList(e, watchlist);}

		function click_handler_1({ idx }, e) {
			return handleDeleteWatchList(e, idx);
		}

		function click_handler_2(e) {handleAddNewWatchlist(e);}

		function click_handler_3({ idx }, e) {
			return handleDeleteSymbol(e, idx);
		}

		function input_input_handler() {
			symbolToAdd = this.value;
			$$invalidate('symbolToAdd', symbolToAdd);
		}

		function click_handler_4(e) {
			return handleAddSymbol(e, clearSymbol(symbolToAdd));
		}

		return {
			watchlist_map,
			watchlistName,
			stockList,
			symbolToAdd,
			autocomplete_result,
			handleDeleteSymbol,
			handleAddSymbol,
			handleChangeWatchList,
			handleAddNewWatchlist,
			handleDeleteWatchList,
			click_handler,
			click_handler_1,
			click_handler_2,
			click_handler_3,
			input_input_handler,
			click_handler_4
		};
	}

	class App extends SvelteComponentDev {
		constructor(options) {
			super(options);
			init(this, options, instance, create_fragment, safe_not_equal, []);
		}
	}

	const app = new App({
		target: document.body,
		props: {
			name: 'world'
		}
	});

	return app;

}());
//# sourceMappingURL=bundle.js.map
