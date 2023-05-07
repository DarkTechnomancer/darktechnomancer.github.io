/*
	Workers actually got quite a bit of new stuff this time, to accommodate our new ping-pong deployment
	method. Well, quite a bit for workers. They're still pretty lightweight. Look at weaken specifically
	for comments on the new changes.
*/

/** @param {NS} ns */
export async function main(ns) {
	const metrics = JSON.parse(ns.args[0]);
	let delay = metrics.end - metrics.time - Date.now();
	// We now allow scripts to deploy late, and report the delay back to the controller so that it can adjust.
	// The port the controller uses for this is registered to the worker's PID.
	if (delay < 0) {
		ns.writePort(metrics.log, `WARN: Batch ${metrics.batch} ${metrics.type} was ${-delay}ms too late.\n`);
		ns.writePort(ns.pid, -delay);
		delay = 0;
	} else {
		ns.writePort(ns.pid, 0);
	}
	await ns.weaken(metrics.target, { additionalMsec: delay });
	const end = Date.now();

	// Back to reporting type, since we want to react to every batch finishing.
	ns.atExit(() => {
		if (metrics.type === "weaken2") ns.writePort(metrics.port, metrics.type);
		ns.writePort(metrics.log, `Batch ${metrics.batch}: ${metrics.type} finished at ${end.toString().slice(-6)}/${Math.round(metrics.end).toString().slice(-6)}\n`);
	});
}
