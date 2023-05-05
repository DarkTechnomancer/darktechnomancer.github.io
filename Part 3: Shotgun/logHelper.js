/*
	This is just a lightweight helper that centralizes all the worker logs somewhere other than the terminal.
	When you've got thousands of workers going at once, the terminal can get really laggy.
	This also saves all logs from the current instance to a text file, which makes it easier to search and review.
*/

/** @param {NS} ns */
export async function main(ns) {

	const logFile = "/part3/log.txt";
	ns.clear(logFile);  // Clear the previous log for each instance.
	ns.disableLog("ALL");
	ns.tail();
	ns.moveTail(200, 200);  // Move it out of the way so it doesn't cover up the controller.
	const logPort = ns.getPortHandle(ns.pid);
	logPort.clear();

	// Pretty simple. Just wait until something writes to the log and save the info.
	// Writes to its own console as well as a text file.
	while (true) {
		await logPort.nextWrite();
		do {
			const data = logPort.read();
			ns.print(data);
			ns.write(logFile, data);
		} while (!logPort.empty());
	}
}
