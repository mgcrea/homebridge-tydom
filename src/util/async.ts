/** A promise that settles after `ms`, with a timer that cannot hold the process open. */
export const asyncWait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
