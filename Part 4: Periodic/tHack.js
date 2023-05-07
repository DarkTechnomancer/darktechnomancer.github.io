/*
	Workers actually got quite a bit of new stuff this time, to accommodate our new ping-pong deployment
	method. Well, quite a bit for workers. They're still pretty lightweight. Look at weaken specifically
	for comments on the new changes.
*/

/** @param {NS} ns */
export async function main(ns) {
	const metrics = JSON.parse(ns.args[0]);
	let delay = metrics.end - metrics.time - Date.now();
	if (delay < 0) {
		ns.writePort(metrics.log, `WARN: Batch ${metrics.batch} ${metrics.type} was ${-delay}ms too late.\n`);
		ns.writePort(ns.pid, -delay);
		delay = 0;
	} else {
		ns.writePort(ns.pid, 0);
	}
	await ns.hack(metrics.target, { additionalMsec: delay });
	const end = Date.now();
	ns.writePort(metrics.log, `Batch ${metrics.batch}: ${metrics.type} finished at ${end.toString().slice(-6)}/${Math.round(metrics.end).toString().slice(-6)}\n`);
}
