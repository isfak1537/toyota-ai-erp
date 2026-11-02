// Day-by-day simulation of one product at one warehouse (SEED-002, 003, 005).
//
// The series is a single chronological event list. balanceAfter is computed in
// running order, so the ledger is internally consistent by construction, stock
// never goes negative, and reserved quantity never exceeds on-hand (the CHECK
// constraint invariant). The only randomness is the Rng passed in.
const {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  BUSINESS_START_UTC_HOUR,
  BUSINESS_END_UTC_HOUR,
  weekdayFactor,
} = require("./config");

const at = (dayMs, hour, minute = 0) => dayMs + hour * HOUR_MS + minute * MINUTE_MS;

// minutes since UTC midnight inside business hours (08:00-17:00 UTC+6)
const businessMinute = (rng) =>
  BUSINESS_START_UTC_HOUR * 60 +
  rng.int(0, (BUSINESS_END_UTC_HOUR - BUSINESS_START_UTC_HOUR) * 60 - 1);

// split `total` units into `parts` positive integers
const splitUnits = (rng, total, parts) => {
  const sizes = Array(parts).fill(1);

  for (let i = 0; i < total - parts; i += 1) {
    sizes[rng.int(0, parts - 1)] += 1;
  }

  return sizes;
};

const ceilTo = (value, step) => Math.ceil(value / step) * step;

const simulateSeries = (cfg) => {
  const {
    rng,
    sku,
    warehouseCode,
    start0,
    days,
    base,
    trend,
    rop,
    orderUpTo,
    options,
    openingQty,
    reservationRate = 0,
    transfersOut = [],
    transfersIn = [],
    steer = null,
    bulk = null,
    injections = [],
  } = cfg;

  const lambdaAt = (d) =>
    base * (1 + trend * (d / (days - 1))) * weekdayFactor(start0 + d * DAY_MS);
  const dayIndex = (ms) => Math.floor((ms - start0) / DAY_MS);

  const events = [];
  const orders = [];
  const daily = [];
  const transferOuts = [];
  const intents = Array.from({ length: days }, () => []);

  let onHand = 0;
  let reserved = 0;
  let seq = 0;
  let orderSeq = 0;

  const add = (d, intent) => {
    if (d < 0 || d >= days) {
      return false;
    }

    intent.seq = seq;
    seq += 1;
    intents[d].push(intent);

    return true;
  };

  const newOrder = ({ quantity, option, createdMs, arrivalDay, arrivalMs, kind, notes }) => {
    const order = {
      id: `${warehouseCode}:${sku}:${orderSeq}`,
      sku,
      warehouseCode,
      supplierCode: option.supplierCode,
      unitPrice: option.unitPrice,
      leadTimeDays: option.leadTimeDays,
      quantity,
      createdMs,
      arrivalMs: null,
      receivedMs: null,
      kind,
      notes: notes ?? null,
    };

    orderSeq += 1;
    orders.push(order);

    if (arrivalDay !== undefined && arrivalDay >= 0 && arrivalDay < days) {
      order.arrivalMs = arrivalMs;
      add(arrivalDay, { ts: arrivalMs, kind: "ARRIVAL", order });
    }

    return order;
  };

  const emit = (ts, type, quantity, extra = {}) => {
    events.push({
      sku,
      warehouseCode,
      type,
      quantity,
      balanceAfter: onHand,
      ts,
      referenceType: null,
      ref: null,
      reason: null,
      anomalyId: null,
      anomalyRole: null,
      ...extra,
    });
  };

  const available = () => onHand - reserved;

  const process = (intent) => {
    const { ts } = intent;

    switch (intent.kind) {
      case "ARRIVAL": {
        const { order } = intent;

        onHand += order.quantity;
        order.receivedMs = ts;
        emit(ts, "RECEIPT", order.quantity, {
          referenceType: "GOODS_RECEIPT",
          ref: { kind: "ORDER", id: order.id },
        });
        break;
      }
      case "ISSUE": {
        const quantity = Math.min(intent.quantity, available());

        if (quantity > 0) {
          onHand -= quantity;
          emit(ts, "ISSUE", -quantity, { referenceType: "MANUAL_ISSUE" });
        }
        break;
      }
      case "RESERVE": {
        const quantity = Math.min(intent.quantity, Math.floor(available() * 0.5));

        if (quantity > 0) {
          reserved += quantity;
          emit(ts, "RESERVATION", 0, {
            referenceType: "MANUAL_RESERVATION",
            reason: `Reserved ${quantity} units`,
          });

          // the matching release happens a few days later (maybe after the end)
          const releaseDay = dayIndex(ts) + intent.holdDays;
          const releaseTs = at(start0 + releaseDay * DAY_MS, 0) + intent.releaseMinute * MINUTE_MS;

          add(releaseDay, { ts: releaseTs, kind: "RELEASE", quantity });
        }
        break;
      }
      case "RELEASE": {
        const quantity = Math.min(intent.quantity, reserved);

        if (quantity > 0) {
          reserved -= quantity;
          emit(ts, "RELEASE", 0, {
            referenceType: "MANUAL_RELEASE",
            reason: `Released ${quantity} units`,
          });
        }
        break;
      }
      case "ADJUST": {
        const delta = intent.quantity < 0 ? -Math.min(-intent.quantity, available()) : intent.quantity;

        if (delta !== 0) {
          onHand += delta;
          emit(ts, "ADJUSTMENT", delta, {
            referenceType: "MANUAL_ADJUSTMENT",
            reason: "Cycle count",
          });
        }
        break;
      }
      case "TRANSFER_OUT": {
        const quantity = Math.min(intent.planned, Math.floor(available() * 0.4));

        if (quantity >= 3) {
          onHand -= quantity;
          emit(ts, "TRANSFER_OUT", -quantity, {
            referenceType: "STOCK_TRANSFER",
            ref: { kind: "TRANSFER", id: intent.id },
          });
          transferOuts.push({ id: intent.id, ts, quantity });
        }
        break;
      }
      case "TRANSFER_IN": {
        onHand += intent.quantity;
        emit(ts, "TRANSFER_IN", intent.quantity, {
          referenceType: "STOCK_TRANSFER",
          ref: { kind: "TRANSFER", id: intent.id },
        });
        break;
      }
      // ---- steering and anomaly injection (SEED-007, SEED-004) ----
      case "TRIM": {
        // last-day correction that lands the available stock on the target
        const quantity = Math.max(0, available() - intent.target);

        if (quantity > 0) {
          onHand -= quantity;
          emit(ts, "ISSUE", -quantity, { referenceType: "MANUAL_ISSUE" });
        }
        break;
      }
      case "INJ_ISSUE": {
        const quantity = Math.min(intent.quantity, available());

        if (quantity > 0) {
          onHand -= quantity;
          emit(ts, "ISSUE", -quantity, {
            referenceType: "MANUAL_ISSUE",
            anomalyId: intent.anomalyId,
            anomalyRole: intent.role ?? null,
          });
        }
        break;
      }
      case "INJ_ADJUST": {
        const quantity = Math.min(-intent.quantity, available());

        if (quantity > 0) {
          onHand -= quantity;
          emit(ts, "ADJUSTMENT", -quantity, {
            referenceType: "MANUAL_ADJUSTMENT",
            reason: "Stock correction",
            anomalyId: intent.anomalyId,
          });
        }
        break;
      }
      case "INJ_RECEIPT": {
        onHand += intent.quantity;
        emit(ts, "RECEIPT", intent.quantity, {
          referenceType: "MANUAL_RECEIPT",
          anomalyId: intent.anomalyId,
        });
        break;
      }
      default:
        throw new Error(`Unknown intent ${intent.kind}`);
    }
  };

  // Steered series (SEED-007): from `suspendFromDay` no new orders are placed
  // (so every order has arrived by the end), and in the last days the demand is
  // planned so that the available stock lands exactly on `steer.target`.
  const planWindow = (d0) => {
    const dayMsOf = (k) => start0 + k * DAY_MS;
    let incoming = 0;

    for (let k = d0; k < days; k += 1) {
      intents[k]
        .filter((intent) => intent.kind === "ARRIVAL")
        .forEach((intent) => {
          incoming += intent.order.quantity;
        });
    }

    let expected = 0;
    const weights = [];

    for (let k = d0; k < days; k += 1) {
      expected += lambdaAt(k);
      weights.push(weekdayFactor(dayMsOf(k)) * (0.7 + 0.6 * rng.next()));
    }

    let toIssue = available() + incoming - steer.target;
    const minIssue = Math.ceil(0.6 * expected);

    if (toIssue < minIssue) {
      // not enough stock to run the demand down to the target: a supplier
      // delivery arrives at the start of the window
      const option = options[0];
      const quantity = ceilTo(minIssue - toIssue, option.minimumOrderQty);
      const arrivalDay = d0 + 1;
      const arrivalMs = at(dayMsOf(arrivalDay), 3, rng.int(0, 119));

      newOrder({
        quantity,
        option,
        createdMs: arrivalMs - option.leadTimeDays * DAY_MS,
        arrivalDay,
        arrivalMs,
        kind: "TOPUP",
      });
      toIssue += quantity;
    }

    const totalWeight = weights.reduce((a, b) => a + b, 0);

    for (let k = d0; k < days - 1; k += 1) {
      const share = Math.floor((toIssue * weights[k - d0]) / totalWeight);

      if (share > 0) {
        const sizes = splitUnits(rng, share, Math.min(share, rng.int(1, 3)));
        const minutes = sizes.map(() => businessMinute(rng)).sort((a, b) => a - b);

        sizes.forEach((quantity, i) => {
          add(k, { ts: dayMsOf(k) + minutes[i] * MINUTE_MS, kind: "ISSUE", quantity });
        });
      }
    }

    add(days - 1, { ts: at(dayMsOf(days - 1), 10, 30), kind: "TRIM", target: steer.target });
  };

  // Opening stock arrives on the first morning through a purchase order that
  // was placed before the history starts, so the ledger starts from zero.
  const openingOption = options[0];

  newOrder({
    quantity: openingQty,
    option: openingOption,
    createdMs: at(start0 - openingOption.leadTimeDays * DAY_MS, 9),
    arrivalDay: 0,
    arrivalMs: at(start0, 2, 30),
    kind: "OPENING",
  });

  for (let d = 0; d < days; d += 1) {
    const dayMs = start0 + d * DAY_MS;

    if (steer && d === steer.windowStart) {
      planWindow(d);
    }

    const planned = steer && d >= steer.windowStart;

    if (!planned) {
      const demand = rng.poisson(lambdaAt(d));

      if (demand > 0) {
        const sizes = splitUnits(rng, demand, Math.min(demand, rng.int(1, 3)));
        const minutes = sizes.map(() => businessMinute(rng)).sort((a, b) => a - b);

        sizes.forEach((quantity, i) => {
          add(d, { ts: dayMs + minutes[i] * MINUTE_MS, kind: "ISSUE", quantity });
        });
      }

      if (rng.chance(reservationRate)) {
        add(d, {
          ts: dayMs + businessMinute(rng) * MINUTE_MS,
          kind: "RESERVE",
          quantity: rng.int(2, Math.max(3, Math.round(base * 4))),
          holdDays: rng.int(3, 10),
          releaseMinute: businessMinute(rng),
        });
      }

      if (rng.chance(0.012)) {
        const size = rng.int(1, Math.max(2, Math.round(base * 2)));

        add(d, {
          ts: dayMs + businessMinute(rng) * MINUTE_MS,
          kind: "ADJUST",
          quantity: rng.chance(0.6) ? -size : size,
        });
      }
    }

    // injected anomalies are fully specified by the builder (own RNG), so the
    // series stream is untouched and identical to the un-injected run up to
    // the injection moment
    injections
      .filter((injection) => injection.day === d)
      .forEach((injection) => {
        const ts = dayMs + injection.minute * MINUTE_MS;

        switch (injection.type) {
          case "SPIKE_ISSUE":
          case "OFF_HOURS_ISSUE":
            add(d, { ts, kind: "INJ_ISSUE", quantity: injection.quantity, anomalyId: injection.id });
            break;
          case "DUPLICATE_ISSUE":
            add(d, { ts, kind: "INJ_ISSUE", quantity: injection.quantity, anomalyId: injection.id, role: "original" });
            add(d, { ts: ts + 3 * MINUTE_MS, kind: "INJ_ISSUE", quantity: injection.quantity, anomalyId: injection.id, role: "duplicate" });
            break;
          case "NEGATIVE_ADJUSTMENT":
            add(d, { ts, kind: "INJ_ADJUST", quantity: -injection.quantity, anomalyId: injection.id });
            break;
          case "MANUAL_RECEIPT":
            add(d, { ts, kind: "INJ_RECEIPT", quantity: injection.quantity, anomalyId: injection.id });
            break;
          default:
            throw new Error(`Unknown injection ${injection.type}`);
        }
      });

    transfersOut
      .filter((transfer) => transfer.day === d)
      .forEach((transfer) =>
        add(d, { ts: at(dayMs, 4, 30), kind: "TRANSFER_OUT", planned: transfer.plannedQty, id: transfer.id })
      );

    transfersIn
      .filter((transfer) => dayIndex(transfer.ts) === d)
      .forEach((transfer) =>
        add(d, { ts: transfer.ts, kind: "TRANSFER_IN", quantity: transfer.quantity, id: transfer.id })
      );

    intents[d].sort((a, b) => a.ts - b.ts || a.seq - b.seq);

    // intents may add intents for later days (releases), never for this one
    for (const intent of intents[d]) {
      process(intent);
    }

    // end of day: reorder when the inventory position falls to the reorder point
    const onOrder = orders
      .filter((order) => order.receivedMs === null)
      .reduce((sum, order) => sum + order.quantity, 0);
    const position = available() + onOrder;

    if (bulk && d === bulk.day) {
      // one large purchase ahead of the end (SEED-007 overstock scenario)
      const option = options[0];
      const target = Math.ceil(bulk.coverDays * base * (1 + trend / 2));
      const quantity = Math.max(
        option.minimumOrderQty,
        ceilTo(target - position, option.minimumOrderQty)
      );
      const arrivalDay = d + option.leadTimeDays + 1;

      newOrder({
        quantity,
        option,
        createdMs: at(dayMs, 10, 0),
        arrivalDay,
        arrivalMs: at(start0 + arrivalDay * DAY_MS, 3, 30),
        kind: "BULK",
        notes: "Bulk purchase (synthetic overstock scenario)",
      });
    } else if (position <= rop && !(steer && d >= steer.suspendFromDay)) {
      const option =
        options.length > 1 && rng.chance(0.15)
          ? options[1 + rng.int(0, options.length - 2)]
          : options[0];
      const quantity = Math.max(
        option.minimumOrderQty,
        ceilTo(orderUpTo - position, option.minimumOrderQty)
      );
      const arrivalDay = d + option.leadTimeDays + rng.int(0, 1);

      newOrder({
        quantity,
        option,
        createdMs: at(dayMs, 10, rng.int(0, 29)),
        arrivalDay,
        arrivalMs: at(start0 + arrivalDay * DAY_MS, 3, rng.int(0, 119)),
        kind: "REPLENISHMENT",
      });
    }

    daily.push({ day: d, onHand, reserved });
  }

  return { events, orders, daily, transferOuts, onHand, reserved };
};

module.exports = { simulateSeries, at, businessMinute, splitUnits, ceilTo };
