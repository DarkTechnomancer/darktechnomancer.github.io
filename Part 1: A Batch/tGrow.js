/*
These workers mostly speak for themselves. They get a map of metrics from the controller, then attempt to do their job.
If they deploy too late to land on their expected end times, they abort. For now, reporting is sent straight to the
console terminal.
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
	await ns.grow(metrics.target, { additionalMsec: delay });
	const end = Date.now();
	ns.tprint(`${metrics.type} finished at ${end}/${metrics.end}`);
}
