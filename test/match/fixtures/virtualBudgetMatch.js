// Match-host option probe only: no gameplay, clocks or heartbeat behavior is replaced.
export class Match {
  constructor(options) { this.options = options; }
  start() {
    this.options.onEnd({ victory: false, probe: {
      virtual: this.options.scheduler?.virtual === true,
      instant: this.options.scheduler?.instant === true,
      budget: Number.isFinite(this.options.headlessSliceMs) ? this.options.headlessSliceMs : null,
    } });
  }
  dispose() {}
}
