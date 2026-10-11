import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventSourceType as Source, OsEventTypeList as Event } from '@evenrealities/even_hub_sdk';
import { gestureAction, gestureInput, tapIntent } from '../src/state/gestures';
import { DeviceBatteries } from '../src/state/devices';
import { daylightPosition } from '../src/display/dashboard-art';
test('temple capture-stream holds and taps survive empty system envelopes', () => {
  assert.deepEqual(
    gestureInput({
      sysEvent: {},
      textEvent: { containerID: 1, eventType: Event.LONG_PRESS_EVENT },
    }),
    { type: Event.LONG_PRESS_EVENT, source: undefined },
  );
  assert.equal(
    gestureAction(
      gestureInput({ textEvent: { eventType: Event.LONG_PRESS_RELEASE_EVENT } })!.type,
      undefined,
      'personal',
    ),
    'release',
  );
  assert.equal(
    gestureInput({ textEvent: { containerID: 9, eventType: Event.CLICK_EVENT } }),
    undefined,
  );
  assert.equal(gestureInput({ sysEvent: { eventType: Event.IMU_DATA_REPORT } }), undefined);
  assert.deepEqual(gestureInput({ listEvent: { containerID: 1 } }), {
    type: undefined,
    source: undefined,
  });
  assert.deepEqual(
    gestureInput({
      sysEvent: { eventType: Event.LONG_PRESS_EVENT },
      textEvent: { eventType: Event.CLICK_EVENT },
    }),
    { type: Event.LONG_PRESS_EVENT, source: undefined },
  );
});
test('single-tap voice works without a ring and preserves uncertain microphone states', () => {
  assert.equal(tapIntent('idle', false), 'listen');
  assert.equal(tapIntent('starting', false), 'finish');
  assert.equal(tapIntent('listening', false), 'finish');
  assert.equal(tapIntent('stopping', false), 'none');
  assert.equal(tapIntent('error', false), 'none');
  assert.equal(tapIntent('idle', true), 'cancel');
});
test('left double tap toggles dashboard, right holds for voice, ring preserves exit profile', () => {
  for (const s of [Source.TOUCH_EVENT_FROM_RING, Source.TOUCH_EVENT_FROM_GLASSES_L]) {
    assert.equal(
      gestureAction(Event.DOUBLE_CLICK_EVENT, s, 'personal'),
      s === Source.TOUCH_EVENT_FROM_GLASSES_L ? 'dashboard' : 'passive',
    );
    assert.equal(gestureAction(Event.LONG_PRESS_EVENT, s, 'personal'), 'listen');
    assert.equal(gestureAction(Event.LONG_PRESS_RELEASE_EVENT, s, 'personal'), 'release');
  }
  assert.equal(
    gestureAction(Event.DOUBLE_CLICK_EVENT, Source.TOUCH_EVENT_FROM_GLASSES_R, 'personal'),
    'passive',
  );
  assert.equal(
    gestureAction(Event.LONG_PRESS_EVENT, Source.TOUCH_EVENT_FROM_GLASSES_R, 'personal'),
    'listen',
  );
  assert.equal(
    gestureAction(Event.LONG_PRESS_RELEASE_EVENT, Source.TOUCH_EVENT_FROM_GLASSES_R, 'personal'),
    'release',
  );
  assert.equal(gestureAction(Event.DOUBLE_CLICK_EVENT, undefined, 'personal'), 'passive');
  assert.equal(
    gestureAction(Event.DOUBLE_CLICK_EVENT, Source.TOUCH_EVENT_FROM_RING, 'store'),
    'system-exit',
  );
});
test('battery status before identification is retained without assigning glasses values to ring', () => {
  const b = new DeviceBatteries();
  b.register({ sn: 'glasses', model: 'g2', status: { batteryLevel: 80 } });
  assert.equal(b.update({ sn: 'ring', batteryLevel: 45 }), false);
  assert.equal(b.values.ring, undefined);
  b.register({ sn: 'ring', model: 'ring1', status: {} });
  assert.equal(b.values.ring, 45);
  b.update({ sn: 'glasses', batteryLevel: 78 });
  assert.equal(b.values.glasses, 78);
  assert.equal(b.values.ring, 45);
  b.update({ sn: 'ring', batteryLevel: 101 });
  assert.equal(b.values.ring, 45);
});
test('solar line clamps before rise and after set, rejects missing/invalid times', () => {
  const rise = '2026-10-04T06:00:00Z',
    set = '2026-10-04T18:00:00Z';
  assert.deepEqual(daylightPosition(rise, set, Date.parse('2026-10-04T12:00:00Z')), {
    fraction: 0.5,
    day: true,
  });
  assert.equal(daylightPosition(rise, set, 0)?.fraction, 0);
  assert.equal(daylightPosition(rise, set, Infinity)?.fraction, 1);
  assert.equal(daylightPosition('invalid', set), null);
  assert.equal(daylightPosition(set, rise), null);
});

test('explicit raw ring aliases and multi-device payloads survive SDK model normalization', () => {
  const b = new DeviceBatteries();
  assert.equal(
    b.registerPayload({
      devices: [
        { sn: 'g', model: 'G2', status: { batteryLevel: 81 } },
        { sn: 'r', model: 'R1', status: { batteryLevel: 44 } },
      ],
    }),
    2,
  );
  assert.equal(b.values.glasses, 81);
  assert.equal(b.values.ring, 44);
  assert.equal(b.diagnostics().ringIdentified, true);
  assert.equal(
    b.registerPayload({ sn: 'unknown', model: 'other-device', status: { batteryLevel: 99 } }),
    0,
  );
  assert.equal(b.values.ring, 44);
});
test('identity restoration retains device classification but never stale battery values', () => {
  const original = new DeviceBatteries();
  original.register({ sn: 'r', model: 'ring1', status: { batteryLevel: 67 } });
  const b = new DeviceBatteries();
  b.restore(original.identities());
  assert.equal(b.values.ring, undefined);
  assert.equal(b.diagnostics().ringIdentified, true);
  assert.equal(b.update({ sn: 'r', batteryLevel: 63 }), true);
  assert.equal(b.values.ring, 63);
  assert.ok(!JSON.stringify(b.diagnostics()).includes('"sn"'));
});
test('missing and invalid queued updates do not erase a valid reading; a new snapshot beats the queue', () => {
  const b = new DeviceBatteries();
  b.update({ sn: 'r', batteryLevel: 40 });
  b.update({ sn: 'r' });
  b.update({ sn: 'r', batteryLevel: 999 });
  b.register({ sn: 'r', model: 'ring1', status: { batteryLevel: 52 } });
  assert.equal(b.values.ring, 52);
  b.update({ sn: 'r', batteryLevel: 0 }, false);
  assert.equal(b.values.ring, 52);
  b.register({ sn: 'r', model: 'ring1', status: { batteryLevel: 0 } });
  assert.equal(b.values.ring, 0);
  assert.equal(b.register({ sn: 'r', model: 'g2', status: { batteryLevel: 100 } }), false);
  assert.equal(b.values.ring, 0);
});
test('unidentified device readings stay unassigned even when there is only one other device', () => {
  const b = new DeviceBatteries();
  b.register({ sn: 'g', model: 'g2', status: { batteryLevel: 80 } });
  b.update({ sn: 'other', batteryLevel: 45 });
  assert.equal(b.values.ring, undefined);
  assert.equal(b.diagnostics().unidentifiedReadings, 1);
  b.restore(null);
  b.registerPayload({ deviceInfo: { sn: 'other', model: 'ring1', status: {} } });
  assert.equal(b.values.ring, 45);
});

test('explicit R1 serial binding assigns only its matching queued reading and can be undone', () => {
  const b = new DeviceBatteries();
  b.register({ sn: 'GLASSES1', model: 'g2', status: { batteryLevel: 81 } });
  b.update({ sn: 'RING1234', batteryLevel: 46 });
  b.update({ sn: 'OTHER123', batteryLevel: 90 });
  assert.throws(() => b.bindRing('GLASSES1'), /glasses/);
  assert.throws(() => b.bindRing('../'), /exact R1/);
  b.bindRing('RING1234');
  assert.equal(b.values.ring, 46);
  assert.equal(b.values.glasses, 81);
  assert.equal(b.diagnostics().unidentifiedReadings, 1);
  b.forgetRing();
  assert.equal(b.values.ring, undefined);
  assert.equal(b.diagnostics().ringIdentified, false);
  b.update({ sn: 'RING1234', batteryLevel: 44 });
  assert.equal(b.values.ring, undefined);
});

test('raw envelope and proto-case device fields are accepted without guessing unknown models', () => {
  const readings = new DeviceBatteries();
  assert.equal(
    readings.registerPayload({
      data: {
        devices: [{ SN: 'RING5678', deviceModel: 'R1', device_status: { battery_level: 51 } }],
      },
    }),
    1,
  );
  assert.equal(readings.values.ring, 51);
  assert.equal(
    readings.registerPayload({
      sn: 'unknown',
      model: 'g2',
      status: { batteryLevel: 81 },
      devices: [{ sn: 'RING9999', model: 'R1', status: { batteryLevel: 49 } }],
    }),
    2,
  );
  assert.equal(readings.values.ring, 49);
  assert.equal(readings.values.glasses, 81);
});
test('native ring wrappers, flat status and string percentages do not copy glasses readings', () => {
  const devices = new DeviceBatteries();
  devices.registerPayload({ model: 'g2', sn: 'GLASSES', status: { batteryLevel: 90 } });
  devices.registerPayload({
    data: { ringInfo: { serial_number: 'RING-1234', device_status: { battery_percent: '73' } } },
  });
  assert.equal(devices.values.ring, 73);
  assert.equal(devices.values.glasses, 90);
  devices.registerPayload({ device_model: { name: 'Ring1' }, SN: 'RING-1234', batteryLevel: 71 });
  assert.equal(devices.values.ring, 71);
  const onlyGlasses = new DeviceBatteries();
  onlyGlasses.registerPayload({ ringInfo: { deviceModel: 'g2', sn: 'GLASSES', batteryLevel: 80 } });
  assert.equal(onlyGlasses.values.ring, undefined);
  assert.equal(onlyGlasses.values.glasses, 80);
});
test('an explicit ring battery field needs no serial and generic unnamed battery stays unassigned', () => {
  const data = new DeviceBatteries();
  data.registerPayload({
    model: 'g2',
    sn: 'GLASSES',
    status: { batteryLevel: 90, ringBatteryLevel: '68' },
  });
  assert.equal(data.values.ring, 68);
  assert.equal(data.values.glasses, 90);
  const unknown = new DeviceBatteries();
  unknown.registerPayload({ batteryLevel: 68 });
  assert.equal(unknown.values.ring, undefined);
});
