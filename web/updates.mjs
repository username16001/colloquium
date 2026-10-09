// A detected worker must finish installing before reporting an update as ready.
export async function checkForUpdate(registration, {online = true, timeoutMs = 20000} = {}) {
  if (!registration) return 'unavailable';
  if (registration.waiting) return 'ready';
  if (!online) return 'offline';
  try {
    await registration.update();
    const worker = registration.installing;
    if (worker && !['installed', 'activated', 'redundant'].includes(worker.state)) {
      await new Promise((resolve, reject) => {
        const done = error => {
          clearTimeout(timer);
          worker.removeEventListener('statechange', changed);
          error ? reject(error) : resolve();
        };
        const changed = () => {
          if (worker.state === 'redundant') done(Error('Installation failed'));
          else if (['installed', 'activated'].includes(worker.state)) done();
        };
        const timer = setTimeout(() => done(Error('Installation timed out')), timeoutMs);
        worker.addEventListener('statechange', changed);
        changed();
      });
    } else if (worker?.state === 'redundant') return 'failed';
    return registration.waiting ? 'ready' : 'none';
  } catch {
    return 'failed';
  }
}
