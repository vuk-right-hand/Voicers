// Hand-rolled Web Audio + MediaStream mocks for use-voice.ts tests.
// No jsdom, no happy-dom — the surface we need is tiny.

class MockAudioParam {
  constructor(value = 0) {
    this.value = value;
  }
}

class MockAudioNode {
  constructor(ctx) {
    this.context = ctx;
    this._connections = [];
  }
  connect(dest) { this._connections.push(dest); return dest; }
  disconnect() { this._connections = []; }
}

class MockGainNode extends MockAudioNode {
  constructor(ctx) {
    super(ctx);
    this.gain = new MockAudioParam(1);
  }
}

class MockMediaStreamAudioSourceNode extends MockAudioNode {
  constructor(ctx, stream) {
    super(ctx);
    this.mediaStream = stream;
  }
}

export class MockAudioWorkletNode extends MockAudioNode {
  constructor(ctx, name, options = {}) {
    super(ctx);
    this.name = name;
    this.processorOptions = options.processorOptions ?? {};
    this.port = { onmessage: null, postMessage: (data) => {
      // Loopback: pushing into port from worklet would normally fire onmessage
      // on the main-thread end. We expose a helper the test can call.
    } };
    MockAudioWorkletNode.instances.push(this);
  }
}
MockAudioWorkletNode.instances = [];

class MockAudioWorklet {
  constructor() { this.modules = []; }
  async addModule(url) { this.modules.push(url); }
}

export class MockAudioContext {
  constructor(options = {}) {
    // Honor the sampleRate option OR override via MockAudioContext.forcedSampleRate
    const forced = MockAudioContext.forcedSampleRate;
    this.sampleRate = forced !== null ? forced : (options.sampleRate ?? 48000);
    this.state = "running";
    this.destination = new MockAudioNode(this);
    this.audioWorklet = new MockAudioWorklet();
    MockAudioContext.instances.push(this);
  }
  createMediaStreamSource(stream) { return new MockMediaStreamAudioSourceNode(this, stream); }
  createGain() { return new MockGainNode(this); }
  async resume() { this.state = "running"; }
  async close() { this.state = "closed"; }
}
MockAudioContext.instances = [];
MockAudioContext.forcedSampleRate = null;

export class MockMediaStreamTrack {
  constructor(kind = "audio") {
    this.kind = kind;
    this.readyState = "live";
    this.onended = null;
    this.onmute = null;
    this.onunmute = null;
    this._muted = false;
  }
  stop() { this.readyState = "ended"; if (this.onended) this.onended(); }
  fireMute() { this._muted = true; if (this.onmute) this.onmute(); }
  fireUnmute() { this._muted = false; if (this.onunmute) this.onunmute(); }
  fireEnded() { this.readyState = "ended"; if (this.onended) this.onended(); }
}

export class MockMediaStream {
  constructor(tracks = []) { this._tracks = tracks; }
  getTracks() { return this._tracks.slice(); }
  getAudioTracks() { return this._tracks.filter(t => t.kind === "audio"); }
}

export class MockDataChannel {
  constructor() {
    this.readyState = "open";
    this.sent = [];
  }
  send(data) {
    if (this.readyState !== "open") throw new Error("channel closed");
    this.sent.push(data);
  }
}

// ─── Worklet processor driver ──────────────────────────────────────────────
// Runs the worklet source in a sandbox so tests can feed input and capture
// postMessage output — simulates what the AudioWorklet thread would do.
export function createWorkletDriver(workletSource, processorOptions = {}) {
  const captured = [];
  const sandbox = {
    registeredProcessors: {},
    postedMessages: captured,
  };
  const scope = {
    registerProcessor(name, klass) { sandbox.registeredProcessors[name] = klass; },
    AudioWorkletProcessor: class {
      constructor() {
        this.port = {
          postMessage: (data /*, transfer */) => captured.push(data),
        };
      }
    },
    sampleRate: processorOptions.inputSampleRate ?? 16000,
  };
  const fn = new Function(
    "registerProcessor",
    "AudioWorkletProcessor",
    "sampleRate",
    workletSource,
  );
  fn(scope.registerProcessor, scope.AudioWorkletProcessor, scope.sampleRate);

  const Klass = sandbox.registeredProcessors["pcm-processor"];
  if (!Klass) throw new Error("pcm-processor not registered");

  // AudioWorkletNode passes processorOptions via `this.processorOptions`
  class Proc extends Klass {}
  const inst = new Proc();
  inst.processorOptions = processorOptions;
  if (typeof inst._init === "function") inst._init(processorOptions);

  return {
    processor: inst,
    captured,
    feed(float32Input) {
      inst.process([[float32Input]]);
    },
  };
}

export function installWebAudioMocks(globals = globalThis) {
  globals.AudioContext = MockAudioContext;
  globals.AudioWorkletNode = MockAudioWorkletNode;
  globals.MediaStream = MockMediaStream;
  globals.MediaStreamTrack = MockMediaStreamTrack;

  const tracks = [new MockMediaStreamTrack("audio")];
  globals.navigator = globals.navigator ?? {};
  globals.navigator.mediaDevices = {
    getUserMedia: async () => new MockMediaStream(tracks),
  };
  globals.navigator.userAgent = globals.navigator.userAgent ?? "test-runner/1.0";
  globals.Blob = globals.Blob ?? class { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; } };
  globals.URL = globals.URL ?? {};
  globals.URL.createObjectURL = globals.URL.createObjectURL ?? (() => "blob:mock");
  globals.URL.revokeObjectURL = globals.URL.revokeObjectURL ?? (() => {});
  return { tracks };
}

export function resetMocks() {
  MockAudioContext.instances = [];
  MockAudioContext.forcedSampleRate = null;
  MockAudioWorkletNode.instances = [];
}
