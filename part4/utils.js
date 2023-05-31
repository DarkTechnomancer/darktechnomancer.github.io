/*
  We've got a brand new class to look at, but the rest of the file remains unchanged.
*/

/** @param {NS} ns */
export async function main(ns) {
	ns.tprint("This is just a function library, it doesn't do anything.");
}

/*
	This is an overengineered abomination of a custom data structure. It is essentially a double-ended queue,
	but also has a Map stapled to it, just in case we need to access items by id (we don't.)

	The idea is that it can fetch/peek items from the front or back with O(1) timing. This gets around the issue of
	dynamic arrays taking O(n) time to shift, which is terrible behavior for very long queues like the one we're using.
*/
export class Deque {
	#capacity = 0; // The maximum length.
	#length = 0; // The actual number of items in the queue
	#front = 0; // The index of the "head" where data is read from the queue.
	#deleted = 0; // The number of "dead" items in the queue. These occur when items are deleted by index. They are bad.
	#elements; // An inner array to store the data.
	#index = new Map(); // A hash table to track items by ID. Try not to delete items using this, it's bad.

	// Create a new queue with a specific capacity.
	constructor(capacity) {
		this.#capacity = capacity;
		this.#elements = new Array(capacity);
	}

	// You can also convert arrays.
	static fromArray(array, overallocation = 0) {
		const result = new Deque(array.length + overallocation);
		array.forEach(item => result.push(item));
		return result;
	}

	// Deleted items don't count towards length, but they still take up space in the array until they can be cleared.
	// Seriously, don't use the delete function unless it's absolutely necessary.
	get size() {
		return this.#length - this.#deleted;
	}

	isEmpty() {
		return this.#length - this.#deleted === 0;
	}

	// Again, "deleted" items still count towards this. Use caution.
	isFull() {
		return this.#length === this.#capacity;
	}

	// The "tail" where data is typically written to.
	// Unlike the front, which points at the first piece of data, this point at the first empty slot.
	get #back() {
		return (this.#front + this.#length) % this.#capacity;
	}

	// Push a new element into the queue.
	push(value) {
		if (this.isFull()) {
			throw new Error("The deque is full. You cannot add more items.");
		}
		this.#elements[this.#back] = value;
		this.#index.set(value.id, this.#back);
		++this.#length;
	}

	// Pop an item off the back of the queue.
	pop() {
		while (!this.isEmpty()) {
			--this.#length;
			const item = this.#elements[this.#back];
			this.#elements[this.#back] = undefined; // Free up the item for garbage collection.
			this.#index.delete(item.id); // Don't confuse index.delete() with this.delete()
			if (item.status !== "deleted") return item; // Clear any "deleted" items we encounter.
			else --this.#deleted; // If you needed another reason to avoid deleting by ID, this breaks the O(1) time complexity.
		}
		throw new Error("The deque is empty. You cannot delete any items.");
	}

	// Shift an item off the front of the queue. This is the main method for accessing data.
	shift() {
		while (!this.isEmpty()) {
			// Our pointer already knows exactly where the front of the queue is. This is much faster than the array equivalent.
			const item = this.#elements[this.#front];
			this.#elements[this.#front] = undefined;
			this.#index.delete(item.id);

			// Move the head up and wrap around if we reach the end of the array. This is essentially a circular buffer.
			this.#front = (this.#front + 1) % this.#capacity;
			--this.#length;
			if (item.status !== "deleted") return item;
			else --this.#deleted;
		}
		throw new Error("The deque is empty. You cannot delete any items.");
	}

	// Place an item at the front of the queue. Slightly slower than pushing, but still faster than doing it on an array.
	unshift(value) {
		if (this.isFull()) {
			throw new Error("The deque is full. You cannot add more items.");
		}
		this.#front = (this.#front - 1 + this.#capacity) % this.#capacity;
		this.#elements[this.#front] = value;
		this.#index.set(value.id, this.#front);
		++this.#length;
	}

	// Peeking at the front is pretty quick, since the head is already looking at it. We just have to clear those pesky "deleted" items first.
	peekFront() {
		if (this.isEmpty()) {
			throw new Error("The deque is empty. You cannot peek.");
		}

		while (this.#elements[this.#front].status === "deleted") {
			this.#index.delete(this.#elements[this.#front]?.id);
			this.#elements[this.#front] = undefined;
			this.#front = (this.#front + 1) % this.#capacity;
			--this.#deleted;
			--this.#length;

			if (this.isEmpty()) {
				throw new Error("The deque is empty. You cannot peek.");
			}
		}
		return this.#elements[this.#front];
	}

	// Peeking at the back is ever so slightly slower, since we need to recalculate the pointer.
	// It's a tradeoff for the faster push function, and it's a very slight difference either way.
	peekBack() {
		if (this.isEmpty()) {
			throw new Error("The deque is empty. You cannot peek.");
		}

		let back = (this.#front + this.#length - 1) % this.#capacity;
		while (this.#elements[back].status === "deleted") {
			this.#index.delete(this.#elements[back].id);
			this.#elements[back] = undefined;
			back = (back - 1 + this.#capacity) % this.#capacity;
			--this.#deleted;
			--this.#length;

			if (this.isEmpty()) {
				throw new Error("The deque is empty. You cannot peek.");
			}
		}

		return this.#elements[back];
	}

	// Fill the queue with a single value.
	fill(value) {
		while (!this.isFull()) {
			this.push(value);
		}
	}

	// Empty the whole queue.
	clear() {
		while (!this.isEmpty()) {
			this.pop();
		}
	}

	// Check if an ID exists.
	exists(id) {
		return this.#index.has(id);
	}

	// Fetch an item by ID
	get(id) {
		let pos = this.#index.get(id);
		return pos !== undefined ? this.#elements[pos] : undefined;
	}

	// DON'T
	delete(id) {
		let item = this.get(id);
		if (item !== undefined) {
			item.status = "deleted";
			++this.#deleted;
			return item;
		} else {
			throw new Error("Item not found in the deque.");
		}
	}
}

// The recursive server navigation algorithm. The lambda predicate determines which servers to add to the final list.
// You can also plug other functions into the lambda to perform other tasks that check all servers at the same time.
/** @param {NS} ns */
export function getServers(ns, lambdaCondition = () => true, hostname = "home", servers = [], visited = []) {
	if (visited.includes(hostname)) return;
	visited.push(hostname);
	if (lambdaCondition(hostname)) servers.push(hostname);
	const connectedNodes = ns.scan(hostname);
	if (hostname !== "home") connectedNodes.shift();
	for (const node of connectedNodes) getServers(ns, lambdaCondition, node, servers, visited);
	return servers;
}

// Here are a couple of my own getServers modules.
// This one finds the best target for hacking. It tries to balance expected return with time taken.
/** @param {NS} ns */
export function checkTarget(ns, server, target = "n00dles", forms = false) {
	if (!ns.hasRootAccess(server)) return target;
	const player = ns.getPlayer();
	const serverSim = ns.getServer(server);
	const pSim = ns.getServer(target);
	let previousScore;
	let currentScore;
	if (serverSim.requiredHackingSkill <= player.skills.hacking / (forms ? 1 : 2)) {
		if (forms) {
			serverSim.hackDifficulty = serverSim.minDifficulty;
			pSim.hackDifficulty = pSim.minDifficulty;
			previousScore = pSim.moneyMax / ns.formulas.hacking.weakenTime(pSim, player) * ns.formulas.hacking.hackChance(pSim, player);
			currentScore = serverSim.moneyMax / ns.formulas.hacking.weakenTime(serverSim, player) * ns.formulas.hacking.hackChance(serverSim, player);
		} else {
			const weight = (serv) => {
				// Calculate the difference between max and available money
				let diff = serv.moneyMax - serv.moneyAvailable;

				// Calculate the scaling factor as the ratio of the difference to the max money
				// The constant here is just an adjustment to fine tune the influence of the scaling factor
				let scalingFactor = diff / serv.moneyMax * 0.95;

				// Adjust the weight based on the difference, applying the scaling penalty
				return (serv.moneyMax / serv.minDifficulty) * (1 - scalingFactor);
			}
			previousScore = weight(pSim)
			currentScore = weight(serverSim)
		}
		if (currentScore > previousScore) target = server;
	}
	return target;
}

// A simple function for copying a list of scripts to a server.
/** @param {NS} ns */
export function copyScripts(ns, server, scripts, overwrite = false) {
	for (const script of scripts) {
		if ((!ns.fileExists(script, server) || overwrite) && ns.hasRootAccess(server)) {
			ns.scp(script, server);
		}
	}
}

// A generic function to check that a given server is prepped. Mostly just a convenience.
export function isPrepped(ns, server) {
	const tolerance = 0.0001;
	const maxMoney = ns.getServerMaxMoney(server);
	const money = ns.getServerMoneyAvailable(server);
	const minSec = ns.getServerMinSecurityLevel(server);
	const sec = ns.getServerSecurityLevel(server);
	const secFix = Math.abs(sec - minSec) < tolerance;
	return (money === maxMoney && secFix) ? true : false;
}

/*
	This prep function isn't part of the tutorial, but the rest of the code wouldn't work without it.
	I don't make any guarantees, but I've been using it and it's worked well enough. I'll comment it anyway.
	The prep strategy uses a modified proto-batching technique, which will be covered in part 2.
*/
/** @param {NS} ns */
export async function prep(ns, values, ramNet) {
	const maxMoney = values.maxMoney;
	const minSec = values.minSec;
	let money = values.money;
	let sec = values.sec;
	while (!isPrepped(ns, values.target)) {
		const wTime = ns.getWeakenTime(values.target);
		const gTime = wTime * 0.8;
		const dataPort = ns.getPortHandle(ns.pid);
		dataPort.clear();

		const pRam = ramNet.cloneBlocks();
		const maxThreads = Math.floor(ramNet.maxBlockSize / 1.75);
		const totalThreads = ramNet.prepThreads;
		let wThreads1 = 0;
		let wThreads2 = 0;
		let gThreads = 0;
		let batchCount = 1;
		let script, mode;
		/*
		Modes:
		0: Security only
		1: Money only
		2: One shot
		*/

		if (money < maxMoney) {
			gThreads = Math.ceil(ns.growthAnalyze(values.target, maxMoney / money));
			wThreads2 = Math.ceil(ns.growthAnalyzeSecurity(gThreads) / 0.05);
		}
		if (sec > minSec) {
			wThreads1 = Math.ceil((sec - minSec) * 20);
			if (!(wThreads1 + wThreads2 + gThreads <= totalThreads && gThreads <= maxThreads)) {
				gThreads = 0;
				wThreads2 = 0;
				batchCount = Math.ceil(wThreads1 / totalThreads);
				if (batchCount > 1) wThreads1 = totalThreads;
				mode = 0;
			} else mode = 2;
		} else if (gThreads > maxThreads || gThreads + wThreads2 > totalThreads) {
			mode = 1;
			const oldG = gThreads;
			wThreads2 = Math.max(Math.floor(totalThreads / 13.5), 1);
			gThreads = Math.floor(wThreads2 * 12.5);
			batchCount = Math.ceil(oldG / gThreads);
		} else mode = 2;

		// Big buffer here, since all the previous calculations can take a while. One second should be more than enough.
		const wEnd1 = Date.now() + wTime + 1000;
		const gEnd = wEnd1 + values.spacer;
		const wEnd2 = gEnd + values.spacer;

		// "metrics" here is basically a mock Job object. Again, this is just an artifact of repurposed old code.
		const metrics = {
			batch: "prep",
			target: values.target,
			type: "none",
			time: 0,
			end: 0,
			port: ns.pid,
			log: values.log,
			report: false
		};

		// Actually assigning threads. We actually allow grow threads to be spread out in mode 1.
		// This is because we don't mind if the effect is a bit reduced from higher security unlike a normal batcher.
		// We're not trying to grow a specific amount, we're trying to grow as much as possible.
		for (const block of pRam) {
			while (block.ram >= 1.75) {
				const bMax = Math.floor(block.ram / 1.75)
				let threads = 0;
				if (wThreads1 > 0) {
					script = "/part4/tWeaken.js";
					metrics.type = "pWeaken1";
					metrics.time = wTime;
					metrics.end = wEnd1;
					threads = Math.min(wThreads1, bMax);
					if (wThreads2 === 0 && wThreads1 - threads <= 0) metrics.report = true;
					wThreads1 -= threads;
				} else if (wThreads2 > 0) {
					script = "/part4/tWeaken.js";
					metrics.type = "pWeaken2";
					metrics.time = wTime;
					metrics.end = wEnd2;
					threads = Math.min(wThreads2, bMax);
					if (wThreads2 - threads === 0) metrics.report = true;
					wThreads2 -= threads;
				} else if (gThreads > 0 && mode === 1) {
					script = "/part4/tGrow.js";
					metrics.type = "pGrow";
					metrics.time = gTime;
					metrics.end = gEnd;
					threads = Math.min(gThreads, bMax);
					metrics.report = false;
					gThreads -= threads;
				} else if (gThreads > 0 && bMax >= gThreads) {
					script = "/part4/tGrow.js";
					metrics.type = "pGrow";
					metrics.time = gTime;
					metrics.end = gEnd;
					threads = gThreads;
					metrics.report = false;
					gThreads = 0;
				} else break;
				metrics.server = block.server;
				const pid = ns.exec(script, block.server, threads, JSON.stringify(metrics));
				if (!pid) throw new Error("Unable to assign all jobs.");
				block.ram -= 1.75 * threads;
			}
		}

		// Fancy UI stuff to update you on progress.
		const tEnd = ((mode === 0 ? wEnd1 : wEnd2) - Date.now()) * batchCount + Date.now();
		const timer = setInterval(() => {
			ns.clearLog();
			switch (mode) {
				case 0:
					ns.print(`Weakening security on ${values.target}...`);
					break;
				case 1:
					ns.print(`Maximizing money on ${values.target}...`);
					break;
				case 2:
					ns.print(`Finalizing preparation on ${values.target}...`);
			}
			ns.print(`Security: +${ns.formatNumber(sec - minSec, 3)}`);
			ns.print(`Money: \$${ns.formatNumber(money, 2)}/${ns.formatNumber(maxMoney, 2)}`);
			const time = tEnd - Date.now();
			ns.print(`Estimated time remaining: ${ns.tFormat(time)}`);
			ns.print(`~${batchCount} ${(batchCount === 1) ? "batch" : "batches"}.`);
		}, 200);
		ns.atExit(() => clearInterval(timer));

		// Wait for the last weaken to finish.
		do await dataPort.nextWrite(); while (!dataPort.read().startsWith("pWeaken"));
		clearInterval(timer);
		await ns.sleep(100);

		money = ns.getServerMoneyAvailable(values.target);
		sec = ns.getServerSecurityLevel(values.target);
	}
	return true;
}

// I don't actually use this anywhere it the code. It's a debugging tool that I use to test the runtimes of functions.
export function benchmark(lambda) {
	let result = 0;
	for (let i = 0; i <= 1000; ++i) {
		const start = performance.now();
		lambda(i);
		result += performance.now() - start;
	}
	return result / 1000;
}