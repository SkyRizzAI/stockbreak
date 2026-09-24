//! Parity test vectors (A12). Cases are defined here; results are frozen in
//! `vectors/math.json`, which the TypeScript SDK replays (`packages/sdk/test/math.test.ts`).
//! Regenerate after an intentional math change: `UPDATE_VECTORS=1 cargo test -p index_math`.

use super::*;
use serde_json::{json, Value};

fn s(v: Option<u64>) -> Value {
    match v {
        Some(x) => Value::String(x.to_string()),
        None => Value::Null,
    }
}

fn price(p: i64, e: i32) -> Price {
    Price { price: p, expo: e }
}

fn cases() -> Value {
    let mut out = Vec::new();

    // mult_fp_from_f64
    for m in [1.0f64, 2.5, 0.333333333333, 1.000000000001, 17.25, 0.5] {
        out.push(json!({"fn":"mult_fp_from_f64","m":m,"out":mult_fp_from_f64(m).map(|v| v.to_string())}));
    }

    // value_usd / raw_for_value
    let vcases: [(u64, u8, f64, i64, i32); 8] = [
        (100_000_000, 8, 1.0, 23_512_000_000, -8),        // 1 AAPLx @ $235.12
        (123_456_789, 8, 1.0, 17_734_500_000, -8),        // 1.234 NVDAx
        (5_000_000, 6, 1.0, 100_000_000, -8),             // 5 USDC @ $1
        (250_000_000, 8, 2.5, 4_400_000_000, -8),         // scaled x2.5
        (1, 8, 1.0, 132_100_000_000, -8),                 // dust pre-IPO
        (999_999_999_999, 8, 1.0, 50_000, -5),            // expo -5
        (7_000_000, 6, 1.0, 99_990, -5),
        (10_000_000_000_000, 8, 0.5, 60_000_000_000, -8),
    ];
    for (raw, dec, m, p, e) in vcases {
        let mf = mult_fp_from_f64(m).unwrap();
        let v = value_usd(raw, dec, mf, price(p, e));
        out.push(json!({"fn":"value_usd","raw":raw.to_string(),"decimals":dec,"mult_fp":mf.to_string(),"price":p.to_string(),"expo":e,"out":s(v)}));
        if let Some(val) = v {
            out.push(json!({"fn":"raw_for_value","value":val.to_string(),"decimals":dec,"mult_fp":mf.to_string(),"price":p.to_string(),"expo":e,"out":s(raw_for_value(val, dec, mf, price(p, e)))}));
        }
    }

    // swap_out
    let scases: [(u64, u8, f64, i64, u8, f64, i64, u16); 4] = [
        (1_000_000_000, 6, 1.0, 100_000_000, 8, 1.0, 23_512_000_000, 30),
        (100_000_000, 8, 1.0, 23_512_000_000, 6, 1.0, 100_000_000, 30),
        (100_000_000, 8, 2.0, 23_512_000_000, 8, 1.0, 17_734_500_000, 30),
        (12_345, 6, 1.0, 100_000_000, 8, 1.0, 132_100_000_000, 50),
    ];
    for (a, di, mi, pi, dout, mo, po, sp) in scases {
        let mfi = mult_fp_from_f64(mi).unwrap();
        let mfo = mult_fp_from_f64(mo).unwrap();
        out.push(json!({"fn":"swap_out","amount_in":a.to_string(),"in_decimals":di,"in_mult_fp":mfi.to_string(),"in_price":pi.to_string(),"in_expo":-8,
            "out_decimals":dout,"out_mult_fp":mfo.to_string(),"out_price":po.to_string(),"out_expo":-8,"spread_bps":sp,
            "out":s(swap_out(a, di, mfi, price(pi, -8), dout, mfo, price(po, -8), sp))}));
    }

    // join_proportional
    let jcases: [(&[u64], &[u64], u64); 3] = [
        (&[1_000_000, 2_000_000, 3_000_000], &[10_000_000, 20_000_000, 30_000_000], 100_000_000),
        (&[1_000_000, 5_000_000, 3_000_000], &[10_000_000, 20_000_000, 30_000_000], 100_000_000),
        (&[7, 0, 1_000_000_000], &[33_333_333, 0, 777_777_777_777], 123_456_789),
    ];
    for (maxs, bals, sup) in jcases {
        let r = join_proportional(maxs, bals, sup);
        let (st, am) = match r {
            Some((st, am, n)) => (Some(st), am[..n].iter().map(|x| x.to_string()).collect::<Vec<_>>()),
            None => (None, vec![]),
        };
        out.push(json!({"fn":"join_proportional","max_amounts":maxs.iter().map(|x| x.to_string()).collect::<Vec<_>>(),
            "balances":bals.iter().map(|x| x.to_string()).collect::<Vec<_>>(),"supply":sup.to_string(),
            "out":{"shares_total":s(st),"amounts":am}}));
    }

    // redeem_amount / bps_of
    for (n, b, sup) in [(1_000_000u64, 50_000_000u64, 100_000_000u64), (3, 10, 7), (999_999, 123_456_789, 1_000_001)] {
        out.push(json!({"fn":"redeem_amount","net":n.to_string(),"balance":b.to_string(),"supply":sup.to_string(),"out":s(redeem_amount(n,b,sup))}));
    }
    for (a, b) in [(1_000_000u64, 100u16), (999u64, 50u16), (123_456_789u64, 1u16)] {
        out.push(json!({"fn":"bps_of","amount":a.to_string(),"bps":b,"out":s(bps_of(a,b))}));
    }

    // accrue_fees
    let fcases: [(u64, i64, u16, u16, u16, bool); 5] = [
        (100_000_000_000, 31_536_000, 500, 100, 1000, false),
        (100_000_000_000, 86_400, 500, 100, 1000, true),
        (1_000_000, 60, 200, 100, 1000, true),
        (100_000_000_000, 2_592_000, 0, 100, 1000, false),
        (0, 1000, 500, 100, 1000, false),
    ];
    for (sup, el, m, p, r, hp) in fcases {
        let v = accrue_fees(sup, el, m, p, r, hp);
        out.push(json!({"fn":"accrue_fees","supply":sup.to_string(),"elapsed":el.to_string(),"mgmt":m,"platform":p,"royalty":r,"has_parent":hp,
            "out": v.map(|(a,b,c)| json!([a.to_string(),b.to_string(),c.to_string()]))}));
    }

    // drift
    let dcases: [(&[u64], &[u16]); 3] = [
        (&[50_000_000, 30_000_000, 20_000_000], &[5000, 3000, 2000]),
        (&[70_000_000, 20_000_000, 10_000_000], &[5000, 3000, 2000]),
        (&[1, 2, 3, 0], &[2500, 2500, 2500, 2500]),
    ];
    for (vals, t) in dcases {
        let d = drift(vals, t);
        out.push(json!({"fn":"drift","values":vals.iter().map(|x| x.to_string()).collect::<Vec<_>>(),"targets":t,
            "out": d.map(|(a,b)| json!([a,b]))}));
    }

    // share_price / convert_amount
    out.push(json!({"fn":"share_price","nav":"123456789012","supply":"100000000000","out":s(share_price(123_456_789_012, 100_000_000_000))}));
    out.push(json!({"fn":"convert_amount","amount":"123456789","num":"3","den":"2","out":s(convert_amount(123_456_789,3,2))}));
    Value::Array(out)
}

#[test]
fn parity_vectors() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/vectors/math.json");
    let computed = cases();
    if std::env::var("UPDATE_VECTORS").is_ok() || !std::path::Path::new(path).exists() {
        std::fs::create_dir_all(concat!(env!("CARGO_MANIFEST_DIR"), "/vectors")).unwrap();
        std::fs::write(path, serde_json::to_string_pretty(&computed).unwrap() + "\n").unwrap();
    }
    let frozen: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(frozen, computed, "math changed: review and run UPDATE_VECTORS=1 if intended");
}

#[test]
fn sanity() {
    // 1 AAPLx at $235.12 = 235_120_000 micro-USD
    let v = value_usd(100_000_000, 8, MULT_FP, price(23_512_000_000, -8)).unwrap();
    assert_eq!(v, 235_120_000);
    // multiplier 2.0 doubles value
    let v2 = value_usd(100_000_000, 8, 2 * MULT_FP, price(23_512_000_000, -8)).unwrap();
    assert_eq!(v2, 470_240_000);
    // round-trip floors
    let r = raw_for_value(v, 8, MULT_FP, price(23_512_000_000, -8)).unwrap();
    assert!(r <= 100_000_000);
    // one year at 6% total ≈ 6.38% dilution
    let (c, p, _) = accrue_fees(1_000_000_000, 31_536_000, 500, 100, 0, false).unwrap();
    assert!(c + p > 63_000_000 && c + p < 64_000_000);
    assert_eq!(value_usd(1, 8, MULT_FP, price(0, -8)), None);
}
