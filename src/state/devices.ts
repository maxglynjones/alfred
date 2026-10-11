type Model = 'g1' | 'g2' | 'ring1';
function modelOf(value: unknown): Model | undefined {
  if (value && typeof value === 'object') value = (value as { name?: unknown }).name;
  if (typeof value !== 'string') return;
  const model = value
    .toLowerCase()
    .replace(/[ ._-]/g, '')
    .replace(/^devicemodel/, '');
  if (model === 'g1' || model === 'g2') return model;
  if (['r1', 'ring1', 'evenr1'].includes(model)) return 'ring1';
}
function level(value: unknown): number | undefined {
  if (typeof value === 'string' && /^\d{1,3}(?:\.\d+)?$/.test(value.trim())) value = Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return;
  return Math.round(value);
}
export class DeviceBatteries {
  private models = new Map<string, Model>();
  private pending = new Map<string, number>();
  readonly values: { glasses?: number; ring?: number } = {};
  // Keep identity bindings locally across WebView recreation, never cached battery
  // percentages. A second unknown serial is not evidence that it is the ring.
  identities() {
    return Array.from(this.models, ([sn, model]) => ({ sn, model }));
  }
  restore(value: unknown) {
    if (!Array.isArray(value)) return;
    for (const info of value.slice(0, 8)) this.register(info);
  }
  registerPayload(value: unknown, depth = 0): number {
    if (depth > 3 || !value || typeof value !== 'object') return 0;
    if (Array.isArray(value))
      return value
        .slice(0, 8)
        .reduce((count, info) => count + this.registerPayload(info, depth + 1), 0);
    const record = value as Record<string, unknown>;
    const matched = this.register(record) ? 1 : 0;
    // Explicitly named ring fields can identify the battery even without a serial.
    // A generic batteryLevel on an unknown device still never becomes R1.
    const status = (record.status ?? record.deviceStatus) as Record<string, unknown> | undefined;
    this.apply(
      'ring1',
      record.ringBatteryLevel ??
        record.ring_battery_level ??
        record.r1BatteryLevel ??
        status?.ringBatteryLevel ??
        status?.ring_battery_level,
    );

    const typed = [
      ['r1', 'ring1'],
      ['ring', 'ring1'],
      ['ringInfo', 'ring1'],
      ['ring1', 'ring1'],
      ['g2', 'g2'],
    ] as const;
    let count = matched;
    for (const [key, model] of typed) {
      const info = record[key];
      if (info && typeof info === 'object' && !Array.isArray(info))
        count += this.registerPayload(
          {
            ...info,
            model:
              (info as any).model ??
              (info as any).deviceModel ??
              (info as any).device_model ??
              model,
          },
          depth + 1,
        );
    }
    return ['data', 'devices', 'device', 'deviceInfo', 'deviceList', 'ringList', 'rings'].reduce(
      (count, key) => count + this.registerPayload(record[key], depth + 1),
      count,
    );
  }
  unidentified() {
    return Array.from(this.pending, ([sn, battery]) => ({ sn, battery }));
  }
  register(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const raw = value as Record<string, any>;
    const status = raw.status ?? raw.deviceStatus ?? raw.device_status;
    const normalized = {
      sn: raw.sn ?? raw.SN ?? raw.serialNumber ?? raw.serial_number ?? status?.sn,
      model: raw.model ?? raw.deviceModel ?? raw.device_model,
      status: {
        batteryLevel:
          status?.batteryLevel ??
          status?.battery_level ??
          status?.batteryPercent ??
          status?.battery_percent ??
          raw.batteryLevel ??
          raw.battery_level ??
          raw.batteryPercent,
      },
    };
    const info = normalized;
    const model = modelOf(info.model);
    if (!model || typeof info.sn !== 'string' || !info.sn || info.sn.length > 128) return false;
    if (this.models.has(info.sn) && this.models.get(info.sn) !== model) return false;
    this.models.set(info.sn, model);
    if (this.models.size > 8) this.models.delete(this.models.keys().next().value!);
    if (this.pending.has(info.sn)) {
      this.apply(model, this.pending.get(info.sn));
      this.pending.delete(info.sn);
    }
    // A current explicit snapshot supersedes an older queued event.
    this.apply(model, info.status?.batteryLevel);
    return true;
  }
  update(status: { sn: string; batteryLevel?: number }, acceptZero = true) {
    this.register(status);
    const model = this.models.get(status.sn);
    const value = level(status.batteryLevel);
    // SDK DeviceStatus.fromJson defaults omitted batteryLevel to zero. On the
    // live callback, zero requires an explicit raw device snapshot to confirm it.
    if (value === undefined || (!acceptZero && value === 0)) return Boolean(model);
    if (model) this.apply(model, value);
    else if (status.sn) {
      this.pending.set(status.sn, value);
      if (this.pending.size > 8) this.pending.delete(this.pending.keys().next().value!);
    }
    return Boolean(model);
  }
  bindRing(serial: string) {
    const sn = serial.trim();
    if (!/^[A-Za-z0-9._:-]{4,128}$/.test(sn))
      throw Error('Enter the exact R1 serial from its device information or packaging.');
    if (this.models.has(sn) && this.models.get(sn) !== 'ring1')
      throw Error('That serial is identified as glasses, not R1. Check the ring serial.');
    this.register({ sn, model: 'ring1' });
  }
  forgetRing() {
    for (const [sn, model] of this.models) if (model === 'ring1') this.models.delete(sn);
    delete this.values.ring;
  }
  diagnostics() {
    const knownRing = Array.from(this.models.values()).includes('ring1');
    return {
      glassIdentified: Array.from(this.models.values()).some((m) => m === 'g1' || m === 'g2'),
      ringIdentified: knownRing,
      unidentifiedReadings: this.pending.size,
      ring: this.values.ring,
      glasses: this.values.glasses,
    };
  }
  private apply(model: Model, value: unknown) {
    const valid = level(value);
    if (valid === undefined) return;
    if (model === 'ring1') this.values.ring = valid;
    else this.values.glasses = valid;
  }
}
