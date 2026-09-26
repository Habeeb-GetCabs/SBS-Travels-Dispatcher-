// Comprehensive Unit Test Suite for GPS Hardening Engine & Meter Logic
import { GpsHardeningEngine, RawGpsPoint, calculateHaversineKm } from './gpsFilter';
import { calculateCustomTripFare } from './tariffService';

function runGpsTestSuite() {
  console.log('---------------------------------------------------------');
  console.log('RUNNING GPS HARDENING & METER RELIABILITY UNIT TESTS');
  console.log('---------------------------------------------------------\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      passed++;
      console.log(`[PASS] Test ${total}: ${testName}`);
    } else {
      console.error(`[FAIL] Test ${total}: ${testName} - ${detail || 'Assertion failed'}`);
    }
  }

  const engine = new GpsHardeningEngine();
  const baseTime = 1700000000000; // Fixed epoch time

  // Test 1: Valid moving GPS points (realistic 36 km/h driving: ~30m displacement in 3s)
  engine.reset();
  const fix1 = engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 10, timestamp: baseTime });
  const fix2 = engine.processRawGps({ latitude: 11.0170, longitude: 76.9560, accuracy: 12, speed: 10, timestamp: baseTime + 3000 });
  assert(fix2.isValid && fix2.distanceDeltaKm > 0 && !fix2.isStationary, `Valid moving GPS points accumulate distance (delta=${fix2.distanceDeltaKm.toFixed(3)}km)`);

  // Test 2: Stationary GPS jitter
  engine.reset();
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 15, speed: 0, timestamp: baseTime });
  const jitterFix1 = engine.processRawGps({ latitude: 11.016805, longitude: 76.955805, accuracy: 20, speed: 0, timestamp: baseTime + 1000 });
  const jitterFix2 = engine.processRawGps({ latitude: 11.016795, longitude: 76.955795, accuracy: 18, speed: 0, timestamp: baseTime + 2000 });
  assert(jitterFix1.distanceDeltaKm === 0 && jitterFix2.distanceDeltaKm === 0 && jitterFix2.isStationary, 'Stationary GPS jitter is suppressed (0 distance added)');

  // Test 3: Small movement
  engine.reset();
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 1, timestamp: baseTime });
  const smallFix = engine.processRawGps({ latitude: 11.01682, longitude: 76.95582, accuracy: 10, speed: 1.5, timestamp: baseTime + 2000 });
  assert(smallFix.isValid, 'Small movement is processed safely');

  // Test 4: Slow real movement (Traffic creep)
  engine.reset();
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 5, speed: 2, timestamp: baseTime });
  const creepFix = engine.processRawGps({ latitude: 11.0170, longitude: 76.9560, accuracy: 5, speed: 2.5, timestamp: baseTime + 5000 });
  assert(creepFix.isValid, 'Slow real vehicle movement is retained without false discard');

  // Test 5: Poor accuracy (> 85m)
  engine.reset();
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 10, timestamp: baseTime });
  const poorFix = engine.processRawGps({ latitude: 11.0250, longitude: 76.9650, accuracy: 120, speed: 10, timestamp: baseTime + 2000 });
  assert(!poorFix.isValid && poorFix.rejectionReason === 'POOR_ACCURACY' && poorFix.distanceDeltaKm === 0, 'Poor accuracy (> 85m) is rejected');

  // Test 6: 0,0 coordinate (Null Island)
  engine.reset();
  const nullIslandFix = engine.processRawGps({ latitude: 0, longitude: 0, accuracy: 5, speed: 10, timestamp: baseTime });
  assert(!nullIslandFix.isValid && nullIslandFix.rejectionReason === 'INVALID_COORDINATES', '0,0 Null Island coordinate is rejected');

  // Test 7: Duplicate timestamp
  engine.reset();
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 10, timestamp: baseTime });
  const dupFix = engine.processRawGps({ latitude: 11.0170, longitude: 76.9560, accuracy: 10, speed: 10, timestamp: baseTime });
  assert(!dupFix.isValid && dupFix.rejectionReason === 'STALE_TIMESTAMP', 'Duplicate timestamp is rejected');

  // Test 8: Older timestamp
  engine.reset();
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 10, timestamp: baseTime + 5000 });
  const olderFix = engine.processRawGps({ latitude: 11.0170, longitude: 76.9560, accuracy: 10, speed: 10, timestamp: baseTime + 1000 });
  assert(!olderFix.isValid && olderFix.rejectionReason === 'STALE_TIMESTAMP', 'Older timestamp is rejected');

  // Test 9: Impossible GPS jump
  engine.reset();
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 10, timestamp: baseTime });
  const jumpFix = engine.processRawGps({ latitude: 12.0168, longitude: 77.9558, accuracy: 10, speed: 10, timestamp: baseTime + 1000 });
  assert(!jumpFix.isValid && jumpFix.rejectionReason === 'IMPOSSIBLE_JUMP' && jumpFix.distanceDeltaKm === 0, 'Impossible GPS jump is rejected with 0 distance added');

  // Test 10: Excessive calculated speed (> 150 km/h)
  engine.reset();
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 10, timestamp: baseTime });
  const speedFix = engine.processRawGps({ latitude: 11.0568, longitude: 76.9958, accuracy: 10, speed: 20, timestamp: baseTime + 2000 });
  assert(!speedFix.isValid && speedFix.rejectionReason === 'IMPOSSIBLE_JUMP', 'Excessive calculated segment speed is rejected');

  // Test 11: Mock / Suspicious Location
  engine.reset();
  const mockFix = engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 5, speed: 10, timestamp: baseTime, isMock: true });
  assert(!mockFix.isValid && mockFix.rejectionReason === 'MOCK_LOCATION', 'Mock/suspicious location signal is rejected');

  // Test 12: GPS Loss Detection (> 7s gap)
  engine.reset();
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 10, timestamp: baseTime });
  const signalState = engine.checkSignalLiveness(baseTime + 10000);
  assert(signalState === 'GPS_LOST', 'GPS loss (> 7s gap) is detected as GPS_LOST');

  // Test 13: GPS Recovery
  engine.reset();
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 10, timestamp: baseTime - 10000 });
  engine.processRawGps({ latitude: 11.0170, longitude: 76.9560, accuracy: 10, speed: 10, timestamp: baseTime });
  assert(engine.checkSignalLiveness(baseTime) === 'GOOD', 'GPS signal recovery resets liveness to GOOD');

  // Test 14: GPS Recovery After Rejected Jump (3 consecutive consistent points)
  engine.reset();
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 10, timestamp: baseTime });
  engine.processRawGps({ latitude: 12.0168, longitude: 77.9558, accuracy: 10, speed: 10, timestamp: baseTime + 1000 }); // Jump 1
  engine.processRawGps({ latitude: 12.0169, longitude: 77.9559, accuracy: 10, speed: 10, timestamp: baseTime + 2000 }); // Jump 2
  const recFix = engine.processRawGps({ latitude: 12.0170, longitude: 77.9560, accuracy: 10, speed: 10, timestamp: baseTime + 3000 }); // Jump 3 Recovery
  assert(recFix.isValid && recFix.healthState === 'GPS_RECOVERING' && recFix.distanceDeltaKm === 0, 'Teleport recovery aligns position without charging jump distance gap');

  // Test 15: Waiting Confirmation
  engine.reset();
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 0, timestamp: baseTime });
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 0, timestamp: baseTime + 1000 });
  const waitFix = engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 0, timestamp: baseTime + 2000 });
  assert(waitFix.isWaitingConfirmed && waitFix.isStationary, 'Waiting is confirmed after consecutive stationary ticks');

  // Test 16: Movement Confirmation (realistic 50 km/h driving)
  engine.reset();
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 0, timestamp: baseTime });
  engine.processRawGps({ latitude: 11.0171, longitude: 76.9561, accuracy: 10, speed: 10, timestamp: baseTime + 3000 });
  const moveFix = engine.processRawGps({ latitude: 11.0174, longitude: 76.9564, accuracy: 10, speed: 14, timestamp: baseTime + 6000 });
  assert(moveFix.isValid && !moveFix.isStationary, 'Movement is confirmed after motion callbacks');

  // Test 17: Moving -> Waiting Transitions
  engine.reset();
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 20, timestamp: baseTime });
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 0, timestamp: baseTime + 1000 });
  const m2w_2 = engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 0, timestamp: baseTime + 2000 });
  assert(m2w_2.isWaitingConfirmed && m2w_2.isStationary, 'Smooth transition from MOVING to WAITING');

  // Test 18: Kalman Filter Response
  engine.reset();
  engine.processRawGps({ latitude: 11.0168, longitude: 76.9558, accuracy: 10, speed: 10, timestamp: baseTime });
  const kFix = engine.processRawGps({ latitude: 11.0178, longitude: 76.9568, accuracy: 15, speed: 12, timestamp: baseTime + 3000 });
  assert(kFix.latitude !== 11.0178 || kFix.longitude !== 76.9568, 'Kalman filter produces smoothed coordinate output');

  // Test 19: Fare Engine Calculation
  const fare = calculateCustomTripFare({
    tariff: {
      pricingType: 'PER_KM',
      baseFare: 50,
      includedKm: 2,
      minimumKm: 2,
      ratePerKm: 15,
      waitingRatePerMinute: 2,
      waitingGraceMinutes: 15,
      driverBata: 0,
      toll: 0,
      parking: 0,
      interstateTax: 0,
      additionalCharges: 0,
      discount: 0,
      roundingRule: 'ROUND_NEAREST',
      quotedAmount: 0,
    },
    distanceKm: 10,
    durationSeconds: 1200,
    waitingSeconds: 300,
  });
  assert(fare.totalFare === 170, 'Fare engine calculates exact fare (50 + (10-2)*15 = 170)');

  console.log('\n---------------------------------------------------------');
  console.log(`SUMMARY: ${passed} / ${total} TESTS PASSED CLEANLY.`);
  console.log('---------------------------------------------------------');

  if (passed !== total) {
    process.exit(1);
  }
}

runGpsTestSuite();
