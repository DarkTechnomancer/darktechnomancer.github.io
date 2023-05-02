/** @param {NS} ns */
export async function main(ns) {
	// First we set up a few values and defaults. Values is a map so it can be passed by reference.
	const ramNet = [];
	const values = {
		totalThreads: 0,
		target: "n00dles",
		maxBlockSize: 0,
		minBlockSize: Infinity,
	}
	const types = ["hack", "weaken1", "grow", "weaken2"];

	// Currently the servers variable isn't used, but we keep it so that we can reiterate through it later.
	// Using predicate injection to do some checks on each server while we're iterating through them.
	const servers = getServers(
		ns,
		(ns, server, pVal = values, pRam = ramNet) => {
			// Finding our best target.
			if (ns.getServerRequiredHackingLevel(server) <= ns.getHackingLevel()) {
				const previousScore = ns.getServerMaxMoney(pVal.target) / ns.getWeakenTime(pVal.target);
				const currentScore = ns.getServerMaxMoney(server) / ns.getWeakenTime(server);
				if (currentScore > previousScore) pVal.target = server;
			}
			/*
			Servers we have root access to can be used to build up our botnet.
			I split up the ram into a map of memory blocks because I have a crippling map addiction.
			Also because it will make it easier to figure out how many threads we can assign.
			*/
			if (ns.hasRootAccess(server)) {
				const ram = ns.getServerMaxRam(server) - ns.getServerUsedRam(server);
				if (ram >= 1.60) {
					const block = { server: server, ram: ram, used: false };
					pRam.push(block);
					if (ram < pVal.minBlockSize) pVal.minBlockSize = ram;
					if (ram > pVal.maxBlockSize) pVal.maxBlockSize = ram;
					pVal.totalThreads += Math.floor(ram / 1.75);
					return true;
				}
			}
		}
	)

	// Sorting our ram smallest first, so that smaller memory blocks will be prioritized when assigning threads.
	ramNet.sort((x, y) => x.ram - y.ram);

	// Since I don't have formulas, I use this brute force algorithm to determine our maximum thresholds.
	const maxThreads = ramNet.slice(-1)[0].ram / 1.75;
	const maxMoney = ns.getServerMaxMoney(values.target);
	let gThreads = 0;
	let greed = 0.99;
	while (greed >= 0.001) {
		const threads = Math.ceil(ns.growthAnalyze(values.target, maxMoney / (maxMoney - (maxMoney * greed))));
		if (threads < maxThreads) {
			gThreads = threads;
			break;
		}
		greed -= 0.001;
	}

	/*
	Just because we can support a certain number of growth threads (which are always the highest)
	doesn't necessarily mean we can support the corresponding number of hacks. We cap hack threads to our
	second biggest available server. Then we calculate thread counts and times, using reverse-engineered algorithms
	where we can to save on RAM.
	*/
	const tAmount = maxMoney * greed;
	const hThreads = Math.min(Math.floor(ns.hackAnalyzeThreads(values.target, tAmount)), Math.floor(ramNet.slice(-2)[0].ram / 1.7));
	const wThreads1 = Math.ceil(hThreads * 0.002 / 0.05);
	const wThreads2 = Math.ceil(gThreads * 0.004 / 0.05);
	const wTime = Math.ceil(ns.getWeakenTime(values.target));
	const hTime = Math.ceil(wTime / 4);
	const gTime = Math.ceil(hTime * 3.2);

	/*
	Now we schedule our workers. I'm putting them one second into the future. The buffer helps ensure that
	the scripts will deploy in time to actually execute their instructions.
	*/
	const buffer = 1000;
	const hEnd = Date.now() + wTime + 5 + buffer;
	const wEnd1 = Date.now() + wTime + 10 + buffer;
	const gEnd = Date.now() + wTime + 15 + buffer;
	const wEnd2 = Date.now() + wTime + 20 + buffer;

	// Did I mention the crippling map addiction? You can accomplish the same thing by using regular indices.
	const times = { hack: hTime, weaken1: wTime, grow: gTime, weaken2: wTime };
	const threads = { hack: hThreads, weaken1: wThreads1, grow: gThreads, weaken2: wThreads2 };
	const ends = { hack: hEnd, weaken1: wEnd1, grow: gEnd, weaken2: wEnd2 };
	const scripts = { hack: "tHack.js", weaken1: "tWeaken.js", grow: "tGrow.js", weaken2: "tWeaken.js" };

	// Now we finally deploy our jobs. The metrics will be used by the worker to do its own calculations at no extra RAM cost.
	for (const type of types) {
		const metrics = { target: values.target, type: type, time: times[type], end: ends[type] };
		for (const block of ramNet) {
			if (block.ram / 1.75 >= threads[type] && !block.used) {
				ns.scp(scripts[type], block.server);
				ns.exec(scripts[type], block.server, threads[type], JSON.stringify(metrics));
				block.used = true;
				break;
			}
		}
	}

	/*
	This does nothing for now, but it's a good idea to get into the habit of reinitializing the RAM when we're done with it.
	Later, we'll probably need a more sophisticated way of managing it, but this will suffice for now.
	*/
	for (block of ramNet) block.used = false;
}

/*
This is the function I use to recursively explore the network. The predicate (lambda) is designed to intentionally allow
code injection. This is generally super bad practice in real programming, but I like the flexibility here.
You can design your predicate to do whatever it wants with each hostname visited.
/** @param {NS} ns */
export function getServers(ns, lambdaCondition = (ns, server) => true, hostname = "home", servers = [], visited = []) {
	if (visited.includes(hostname)) return;
	visited.push(hostname);
	if (lambdaCondition(ns, hostname)) servers.push(hostname);
	const connectedNodes = ns.scan(hostname);
	if (hostname !== "home") connectedNodes.shift();
	for (const node of connectedNodes) getServers(ns, lambdaCondition, node, servers, visited);
	return servers;
}
