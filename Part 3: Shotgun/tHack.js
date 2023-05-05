/*
Workers are almost entirely the same. The only major change across all of them is that they now write their logs
to a txt file instead of the terminal. This cuts down on lag and is much easier to read and search through.
Aside from that, the weaken worker now reports its batch number instead of its type to the controller.
*/

/** @param {NS} ns */
export async function main(ns) {
	const metrics = JSON.parse(ns.args[0]);
	const delay = metrics.end - metrics.time - Date.now();
	if (delay < 0) {
		ns.writePort(metrics.log, `ERROR: ${metrics.type} was ${-delay}ms too late.\n`);
		return;
	}
	await ns.hack(metrics.target, { additionalMsec: delay });
	const end = Date.now();
	ns.writePort(metrics.log, `Batch ${metrics.batch}: ${metrics.type} finished at ${end.toString().slice(-6)}/${Math.round(metrics.end).toString().slice(-6)}\n`);
}
