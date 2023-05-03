/*
Workers have been given a minor modification to cut the timestamp down to be a bit more readable.
More importantly, the weaken script now reports back to the controller when finished running.
*/

/** @param {NS} ns */
export async function main(ns) {
	const metrics = JSON.parse(ns.args[0]);
	const delay = metrics.end - metrics.time - Date.now();
	if (delay < 0) {
		ns.tprint(`ERROR: ${metrics.type} was ${-delay}ms too late.`);
		ns.tprint(metrics);
		return;
	}
	await ns.weaken(metrics.target, { additionalMsec: delay });
	const end = Date.now();

	// Write back to the controller when W2 finishes. We pack it into the atExit callback to make sure RAM is cleared.
	ns.atExit(() => {
		if (metrics.type === "weaken2") ns.writePort(metrics.port, metrics.type);
		ns.tprint(`${metrics.type} finished at ${end.toString().slice(-6)}/${Math.round(metrics.end).toString().slice(-6)}`);
	});
}
