function waitForRuntime({ probe, initialize, registerCleanup, status, timers = globalThis }) {
  status.state = 'waiting';
  status.missing = [];
  return new Promise((resolve, reject) => {
    let finished = false;
    let interval;
    const stop = () => {
      if (interval !== undefined) timers.clearInterval(interval);
      interval = undefined;
    };
    const check = () => {
      if (finished) return;
      try {
        status.missing = probe();
        if (status.missing.length) return;
        finished = true;
        stop();
        status.state = 'initializing';
        Promise.resolve().then(initialize).then(result => {
          status.state = result === false ? 'failed' : 'ready';
          resolve(result);
        }, error => {
          status.state = 'failed';
          status.error = String(error?.message || error);
          reject(error);
        });
      } catch (error) {
        finished = true;
        stop();
        status.state = 'failed';
        status.error = String(error?.message || error);
        reject(error);
      }
    };
    registerCleanup(() => {
      stop();
      if (!finished) { finished = true; status.state = 'cancelled'; resolve(false); }
    });
    if (!finished) { interval = timers.setInterval(check, 1000); check(); }
  });
}
module.exports = { waitForRuntime };
