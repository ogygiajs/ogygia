/** One macrotask: every promise callback queued before it has run. Fast in node and in a browser
 *  (a timer would be clamped to 4ms there, too slow for thousands of random runs). */
export function macrotask(): Promise<void> {
	if (typeof setImmediate === 'function') return new Promise((r) => setImmediate(r));
	return new Promise((r) => {
		const channel = new MessageChannel();
		channel.port1.onmessage = () => {
			channel.port1.close();
			r();
		};
		channel.port2.postMessage(null);
	});
}
