class SidPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.current = null;
    this.offset = 0;
    this.playing = false;
    this.underruns = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (data.type === "push") {
        this.queue.push([data.left, data.right]);
      } else if (data.type === "clear") {
        this.queue.length = 0;
        this.current = null;
        this.offset = 0;
      } else if (data.type === "play") {
        this.playing = true;
      } else if (data.type === "pause") {
        this.playing = false;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const left = output[0];
    const right = output[1] || output[0];

    if (!this.playing) {
      left.fill(0);
      if (right !== left) right.fill(0);
      return true;
    }

    let written = 0;
    while (written < left.length) {
      if (!this.current) {
        if (this.queue.length === 0) {
          this.underruns += 1;
          if (this.underruns === 1 || this.underruns % 50 === 0) {
            this.port.postMessage({ type: "underrun", count: this.underruns });
          }
          break;
        }
        this.current = this.queue.shift();
        this.offset = 0;
        this.underruns = 0;
      }
      const [l, r] = this.current;
      const available = l.length - this.offset;
      const n = Math.min(left.length - written, available);
      for (let i = 0; i < n; i += 1) {
        left[written + i] = l[this.offset + i];
        right[written + i] = r[this.offset + i];
      }
      written += n;
      this.offset += n;
      if (this.offset >= l.length) this.current = null;
    }
    if (written < left.length) {
      left.fill(0, written);
      if (right !== left) right.fill(0, written);
    }
    return true;
  }
}

registerProcessor("sid-player", SidPlayerProcessor);
