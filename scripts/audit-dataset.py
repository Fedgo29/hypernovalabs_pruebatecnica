#!/usr/bin/env python3
"""Read a ticketing fixture and emit safe, aggregate QA evidence (Python stdlib).

Never imports data into a service or changes the input. Names, email addresses,
passwords, purchase idempotency keys and client scan IDs are read only in memory;
their values never appear in output. Numeric technical IDs can identify findings.
Exit 0 = no confirmed defect; 1 = confirmed defect; 2 = unreadable/invalid input.
"""

import argparse
from collections import Counter, defaultdict
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import sys


TABLES = (
    "usuarios_administrativos", "organizadores", "staff", "asistentes",
    "eventos", "zonas", "fases_precio", "puertas", "asignaciones_staff",
    "compras", "entradas", "transferencias", "ingresos", "reservas",
)
SENSITIVE_FIELDS = ("nombre", "email", "password", "idempotency_key", "client_scan_id")
TIME_FIELDS = (
    "creado_en", "fecha", "venta_abre", "reembolsable_hasta", "desde", "hasta",
    "pagada_en", "reembolsada_en", "emitida_en", "creada_en", "resuelta_en",
    "escaneado_en", "sincronizado_en", "expira_en",
)
EXPECTED_ENUMS = {
    "usuarios_administrativos": {"rol": ("admin",)},
    "organizadores": {"rol": ("organizador",)},
    "staff": {"rol": ("staff",)},
    "asistentes": {"rol": ("asistente",)},
    "eventos": {"estado": ("finalizado", "en_venta", "proximo")},
    "fases_precio": {"fase": ("preventa", "general", "taquilla")},
    "compras": {"estado": ("pagada", "reembolsada")},
    "entradas": {"estado": ("pagada", "transferida", "usada", "reembolsada")},
    "transferencias": {"estado": ("aceptada", "pendiente", "cancelada", "rechazada")},
    "ingresos": {"resultado": ("valido", "invalido", "duplicado")},
    "reservas": {"estado": ("activa", "expirada", "confirmada", "cancelada")},
}
FKS = {
    "staff": {"organizador_id": "organizadores"},
    "eventos": {"organizador_id": "organizadores"},
    "zonas": {"evento_id": "eventos"},
    "fases_precio": {"zona_id": "zonas"},
    "puertas": {"evento_id": "eventos"},
    "asignaciones_staff": {"evento_id": "eventos", "staff_id": "staff"},
    "compras": {"asistente_id": "asistentes", "evento_id": "eventos",
                "zona_id": "zonas", "fase_precio_id": "fases_precio"},
    "entradas": {"compra_id": "compras", "evento_id": "eventos", "zona_id": "zonas",
                 "titular_id": "asistentes", "comprador_id": "asistentes"},
    "transferencias": {"entrada_id": "entradas", "de_usuario_id": "asistentes",
                      "a_usuario_id": "asistentes"},
    "ingresos": {"entrada_id": "entradas", "evento_id": "eventos",
                 "puerta_id": "puertas", "staff_id": "staff"},
    "reservas": {"asistente_id": "asistentes", "zona_id": "zonas"},
}


def integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


def instant(value):
    if not isinstance(value, str):
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return result if result.tzinfo is not None else None
    except ValueError:
        return None


def duplicates(values):
    counts = Counter(values)
    return {"groups": sum(n > 1 for n in counts.values()),
            "extra_rows": sum(n - 1 for n in counts.values() if n > 1)}


def numeric_ids(rows):
    return sorted({r["id"] for r in rows if integer(r.get("id"))})[:20]


def audit(raw):
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("root")
    if any(not isinstance(data.get(t), list) for t in TABLES):
        raise ValueError("tables")
    if any(not isinstance(r, dict) for t in TABLES for r in data[t]):
        raise ValueError("rows")
    meta = data.get("meta", {})
    if not isinstance(meta, dict):
        raise ValueError("metadata")
    rows = {t: data[t] for t in TABLES}
    indexes = {t: {r["id"]: r for r in records if integer(r.get("id"))}
               for t, records in rows.items()}
    checks = []

    def check(code, table, affected, classification="confirmed_defect", rule=None):
        affected = list(affected)
        entry = {"code": code, "table": table, "count": len(affected),
                 "classification_if_nonzero": classification,
                 "sample_numeric_ids": numeric_ids(affected)}
        if rule:
            entry["rule"] = rule
        checks.append(entry)
        return affected

    def linked(table, row, field):
        return indexes[FKS[table][field]].get(row.get(field), {})

    counts = {t: len(records) for t, records in rows.items()}
    schema = {}
    pii = {}
    enums = {}
    for table, records in rows.items():
        fields = sorted({key for row in records for key in row})
        schema[table] = {
            key: {"present": sum(key in r for r in records),
                  "null": sum(key in r and r[key] is None for r in records),
                  "types": dict(sorted(Counter(type(r[key]).__name__
                                               for r in records if key in r).items()))}
            for key in fields
        }
        pii[table] = {field: {"present": sum(field in r for r in records),
                             "nonempty": sum(r.get(field) not in (None, "") for r in records)}
                      for field in SENSITIVE_FIELDS if field in fields}
        if table != "asignaciones_staff":
            check("missing_or_noninteger_id", table,
                  (r for r in records if not integer(r.get("id"))))
            id_counts = Counter(r["id"] for r in records if integer(r.get("id")))
            check("duplicate_primary_id", table,
                  (r for r in records if id_counts.get(r.get("id"), 0) > 1))
        if isinstance(meta.get("conteos"), dict) and table in meta["conteos"]:
            check("metadata_count_mismatch", table,
                  [{}] if counts[table] != meta["conteos"][table] else [])
        enums[table] = {}
        for field, allowed in EXPECTED_ENUMS.get(table, {}).items():
            observed = Counter(r.get(field) for r in records)
            enums[table][field] = {v: observed[v] for v in allowed}
            enums[table][field]["other_or_missing_count"] = sum(
                n for v, n in observed.items() if v not in allowed)
            check("unexpected_" + field, table,
                  (r for r in records if r.get(field) not in allowed),
                  "contract_to_confirm", "Enums observed in this fixture; not an official contract.")
        for field, target in FKS.get(table, {}).items():
            check("fk_" + field + "_to_" + target, table,
                  (r for r in records if not integer(r.get(field)) or
                   r.get(field) not in indexes[target]))

    duplicate_counts = {}
    for table, fields in {
        "compras": ("idempotency_key",), "ingresos": ("client_scan_id",),
        "usuarios_administrativos": ("email",), "organizadores": ("email",),
        "staff": ("email",), "asistentes": ("email",),
    }.items():
        duplicate_counts[table] = {
            field: duplicates(r[field] for r in rows[table]
                              if isinstance(r.get(field), str) and r[field])
            for field in fields
        }
    duplicate_counts["asignaciones_staff"] = duplicates(
        (r.get("evento_id"), r.get("staff_id")) for r in rows["asignaciones_staff"])
    identity_tables = ("usuarios_administrativos", "organizadores", "staff", "asistentes")
    duplicate_counts["all_identity_emails"] = duplicates(
        r["email"] for t in identity_tables for r in rows[t]
        if isinstance(r.get("email"), str) and r["email"])
    duplicate_counts["all_identity_ids"] = duplicates(
        r["id"] for t in identity_tables for r in rows[t] if integer(r.get("id")))
    identity_id_counts = Counter(r["id"] for t in identity_tables for r in rows[t]
                                 if integer(r.get("id")))
    check("cross_role_identity_id_collisions", "identity_namespaces",
          (r for t in identity_tables for r in rows[t]
           if identity_id_counts.get(r.get("id"), 0) > 1),
          "contract_to_confirm", "IDs may be scoped to role tables; a unified user table needs a legacy ID mapping.")
    password_values = [r["password"] for t in identity_tables for r in rows[t]
                       if isinstance(r.get("password"), str)]
    recognized_hash = re.compile(r"^(\$2[aby]\$|\$argon2(?:id|i|d)\$|pbkdf2_sha256\$|scrypt\$)")
    password_counts = {"string_values": len(password_values),
                       "distinct_value_count": len(set(password_values)),
                       "recognized_hash_prefix": sum(bool(recognized_hash.match(v)) for v in password_values),
                       "no_recognized_hash_prefix": sum(not recognized_hash.match(v) for v in password_values)}

    # Check redundant relation fields rather than trusting denormalized data.
    for table, field, target_field, source_field in (
        ("compras", "zona_id", "evento_id", "evento_id"),
        ("compras", "fase_precio_id", "zona_id", "zona_id"),
        ("entradas", "compra_id", "evento_id", "evento_id"),
        ("entradas", "compra_id", "zona_id", "zona_id"),
        ("entradas", "compra_id", "asistente_id", "comprador_id"),
        ("ingresos", "entrada_id", "evento_id", "evento_id"),
        ("ingresos", "puerta_id", "evento_id", "evento_id"),
    ):
        check("relation_" + field + "_" + source_field, table,
              (r for r in rows[table] if linked(table, r, field) and
               linked(table, r, field).get(target_field) != r.get(source_field)))
    check("staff_organizer_different_from_event", "asignaciones_staff",
          (r for r in rows["asignaciones_staff"]
           if linked("asignaciones_staff", r, "evento_id") and
           linked("asignaciones_staff", r, "staff_id") and
           linked("asignaciones_staff", r, "evento_id").get("organizador_id") !=
           linked("asignaciones_staff", r, "staff_id").get("organizador_id")))
    assigned = {(r.get("evento_id"), r.get("staff_id")) for r in rows["asignaciones_staff"]}
    check("scan_staff_unassigned_to_event", "ingresos",
          (r for r in rows["ingresos"] if (r.get("evento_id"), r.get("staff_id")) not in assigned),
          "contract_to_confirm", "Assignment effective dates/history are not present.")

    for table, fields in {"zonas": ("aforo",), "compras": ("cantidad",),
                         "reservas": ("cantidad",), "eventos": ("limite_por_cuenta",)}.items():
        for field in fields:
            check("nonpositive_" + field, table,
                  (r for r in rows[table] if not integer(r.get(field)) or r[field] <= 0))
    for table, fields in {"fases_precio": ("precio_centesimos",),
                         "compras": ("precio_unitario_centesimos", "monto_centesimos")}.items():
        for field in fields:
            check("invalid_money_" + field, table,
                  (r for r in rows[table] if not integer(r.get(field)) or r[field] < 0))
    check("purchase_total_arithmetic", "compras",
          (r for r in rows["compras"]
           if all(integer(r.get(k)) for k in
                  ("cantidad", "precio_unitario_centesimos", "monto_centesimos")) and
           r["cantidad"] * r["precio_unitario_centesimos"] != r["monto_centesimos"]))
    check("purchase_price_differs_from_linked_phase", "compras",
          (r for r in rows["compras"] if linked("compras", r, "fase_precio_id") and
           r.get("precio_unitario_centesimos") !=
           linked("compras", r, "fase_precio_id").get("precio_centesimos")),
          "contract_to_confirm", "Price snapshots can differ if a phase was edited after sale.")
    tickets_per_purchase = Counter(r.get("compra_id") for r in rows["entradas"])
    check("purchase_quantity_differs_from_ticket_count", "compras",
          (r for r in rows["compras"] if tickets_per_purchase[r.get("id")] != r.get("cantidad")))
    check("purchase_and_ticket_refund_state_mismatch", "entradas",
          (r for r in rows["entradas"] if linked("entradas", r, "compra_id") and
           (r.get("estado") == "reembolsada") !=
           (linked("entradas", r, "compra_id").get("estado") == "reembolsada")),
          "contract_to_confirm", "Confirm whether refunds must cover every ticket in a purchase.")

    valid_scans = Counter(r.get("entrada_id") for r in rows["ingresos"]
                          if r.get("resultado") == "valido")
    check("used_ticket_without_exactly_one_valid_scan", "entradas",
          (r for r in rows["entradas"] if r.get("estado") == "usada" and
           valid_scans[r.get("id")] != 1))
    check("valid_scan_ticket_not_used", "ingresos",
          (r for r in rows["ingresos"] if r.get("resultado") == "valido" and
           linked("ingresos", r, "entrada_id") and
           linked("ingresos", r, "entrada_id").get("estado") != "usada"))
    check("multiple_valid_scans", "entradas",
          (r for r in rows["entradas"] if valid_scans[r.get("id")] > 1))
    for table, field, state_field, state in (
        ("compras", "reembolsada_en", "estado", "reembolsada"),
        ("transferencias", "resuelta_en", "estado", "aceptada"),
    ):
        check("missing_timestamp_for_" + state, table,
              (r for r in rows[table] if r.get(state_field) == state and not r.get(field)))
    check("pending_transfer_has_resolution", "transferencias",
          (r for r in rows["transferencias"] if r.get("estado") == "pendiente" and
           r.get("resuelta_en") is not None))
    check("self_transfer", "transferencias",
          (r for r in rows["transferencias"] if r.get("de_usuario_id") == r.get("a_usuario_id")))
    accepted_by_ticket = defaultdict(list)
    for transfer in rows["transferencias"]:
        if transfer.get("estado") == "aceptada" and instant(transfer.get("resuelta_en")):
            accepted_by_ticket[transfer.get("entrada_id")].append(transfer)
    last_recipient = {ticket: max(transfers, key=lambda r: instant(r["resuelta_en"])).get("a_usuario_id")
                      for ticket, transfers in accepted_by_ticket.items()}
    check("last_accepted_transfer_differs_from_current_holder", "entradas",
          (r for r in rows["entradas"] if r.get("id") in last_recipient and
           r.get("titular_id") != last_recipient[r["id"]]),
          "contract_to_confirm", "Assumes complete transfer history and no administrative ownership override.")
    check("pending_transfer_sender_differs_from_current_holder", "transferencias",
          (r for r in rows["transferencias"] if r.get("estado") == "pendiente" and
           linked("transferencias", r, "entrada_id") and
           r.get("de_usuario_id") != linked("transferencias", r, "entrada_id").get("titular_id")))
    check("transferred_ticket_holder_equals_buyer", "entradas",
          (r for r in rows["entradas"] if r.get("estado") == "transferida" and
           r.get("titular_id") == r.get("comprador_id")),
          "contract_to_confirm", "Metadata describes transferida as held by another user.")
    check("paid_ticket_holder_differs_from_buyer", "entradas",
          (r for r in rows["entradas"] if r.get("estado") == "pagada" and
           r.get("titular_id") != r.get("comprador_id")),
          "contract_to_confirm", "Metadata describes pagada as held by the buyer.")

    reference = instant(meta.get("referencia_temporal"))
    check("missing_or_invalid_reference_timestamp", "meta", [{}] if not reference else [])
    timestamps = {}
    for table, records in rows.items():
        timestamps[table] = {}
        for field in TIME_FIELDS:
            if not any(field in r for r in records):
                continue
            parsed = [instant(r.get(field)) for r in records if r.get(field) is not None]
            valid = [t for t in parsed if t is not None]
            timestamps[table][field] = {
                "nonnull": len(parsed), "invalid_or_without_timezone": len(parsed) - len(valid),
                "min": min(valid).isoformat() if valid else None,
                "max": max(valid).isoformat() if valid else None,
                "after_reference": sum(t > reference for t in valid) if reference else None,
            }
            check("invalid_timestamp_" + field, table,
                  (r for r in records if r.get(field) is not None and instant(r[field]) is None))
    for table, earlier, later, strict in (
        ("eventos", "venta_abre", "fecha", True),
        ("eventos", "reembolsable_hasta", "fecha", False),
        ("fases_precio", "desde", "hasta", True),
        ("compras", "pagada_en", "reembolsada_en", False),
        ("transferencias", "creada_en", "resuelta_en", False),
        ("ingresos", "escaneado_en", "sincronizado_en", False),
        ("reservas", "creada_en", "expira_en", True),
    ):
        check("time_order_" + earlier + "_" + later, table,
              (r for r in rows[table] if instant(r.get(earlier)) and instant(r.get(later)) and
               (instant(r[earlier]) >= instant(r[later]) if strict else
                instant(r[earlier]) > instant(r[later]))))
    check("payment_outside_phase_interval", "compras",
          (r for r in rows["compras"] if instant(r.get("pagada_en")) and
           instant(linked("compras", r, "fase_precio_id").get("desde")) and
           instant(linked("compras", r, "fase_precio_id").get("hasta")) and
           not (instant(linked("compras", r, "fase_precio_id")["desde"]) <=
                instant(r["pagada_en"]) < instant(linked("compras", r, "fase_precio_id")["hasta"]))),
          "contract_to_confirm", "Uses [desde, hasta); actual price is locked at reservation, absent here.")
    check("refund_after_event_deadline", "compras",
          (r for r in rows["compras"] if instant(r.get("reembolsada_en")) and
           instant(linked("compras", r, "evento_id").get("reembolsable_hasta")) and
           instant(r["reembolsada_en"]) >
           instant(linked("compras", r, "evento_id")["reembolsable_hasta"])),
          "contract_to_confirm", "Cancellation/administrative exceptions are not documented.")
    check("scan_before_ticket_emission", "ingresos",
          (r for r in rows["ingresos"] if instant(r.get("escaneado_en")) and
           instant(linked("ingresos", r, "entrada_id").get("emitida_en")) and
           instant(r["escaneado_en"]) < instant(linked("ingresos", r, "entrada_id")["emitida_en"])))
    phase_intervals = []
    for zone in rows["zonas"]:
        phases = sorted((r for r in rows["fases_precio"] if r.get("zona_id") == zone.get("id")
                         and instant(r.get("desde")) and instant(r.get("hasta"))),
                        key=lambda r: instant(r["desde"]))
        phase_intervals.append({
            "zona_id": zone.get("id") if integer(zone.get("id")) else None,
            "phase_count": len(phases),
            "overlapping_adjacent_intervals": sum(instant(a["hasta"]) > instant(b["desde"])
                                                  for a, b in zip(phases, phases[1:])),
            "gaps_between_adjacent_intervals": sum(instant(a["hasta"]) < instant(b["desde"])
                                                  for a, b in zip(phases, phases[1:])),
        })

    active_ticket_states = ("pagada", "transferida", "usada")
    occupied = Counter(r.get("zona_id") for r in rows["entradas"]
                       if r.get("estado") in active_ticket_states)
    available_reservations = [r for r in rows["reservas"] if r.get("estado") == "activa"
                              and reference and instant(r.get("expira_en"))
                              and instant(r["expira_en"]) > reference]
    held = Counter()
    for row in available_reservations:
        if integer(row.get("cantidad")):
            held[row.get("zona_id")] += row["cantidad"]
    stock = [{"zona_id": z["id"], "evento_id": z.get("evento_id"), "capacity": z.get("aforo"),
              "nonrefunded_tickets": occupied[z["id"]],
              "live_active_reservation_quantity_at_reference": held[z["id"]],
              "remaining_from_tickets": z["aforo"] - occupied[z["id"]],
              "remaining_with_live_reservations": z["aforo"] - occupied[z["id"]] - held[z["id"]]}
             for z in rows["zonas"] if integer(z.get("id")) and integer(z.get("aforo"))]
    check("tickets_exceed_zone_capacity", "zonas",
          (z for z in rows["zonas"] if integer(z.get("aforo")) and
           occupied[z.get("id")] > z["aforo"]))
    check("stock_negative_including_live_reservations", "zonas",
          (z for z in rows["zonas"] if integer(z.get("aforo")) and
           occupied[z.get("id")] + held[z.get("id")] > z["aforo"]),
          "contract_to_confirm", "Fixture has no reservation-to-purchase link; avoid double counting on import.")
    check("active_reservation_expired_at_reference", "reservas",
          (r for r in rows["reservas"] if r.get("estado") == "activa" and reference and
           instant(r.get("expira_en")) and instant(r["expira_en"]) <= reference),
          "contract_to_confirm", "Expiration may be computed on read instead of persisting a state transition.")
    check("expired_reservation_still_future_at_reference", "reservas",
          (r for r in rows["reservas"] if r.get("estado") == "expirada" and reference and
           instant(r.get("expira_en")) and instant(r["expira_en"]) > reference))
    reservation_durations = Counter(
        int((instant(r["expira_en"]) - instant(r["creada_en"])).total_seconds())
        for r in rows["reservas"] if instant(r.get("expira_en")) and instant(r.get("creada_en")))
    purchased = Counter((r.get("comprador_id"), r.get("evento_id")) for r in rows["entradas"]
                        if r.get("estado") in active_ticket_states)
    owned = Counter((r.get("titular_id"), r.get("evento_id")) for r in rows["entradas"]
                    if r.get("estado") in active_ticket_states)
    quota = {}
    for name, usage in (("original_buyer", purchased), ("current_holder", owned)):
        quota[name] = {"user_event_pairs": len(usage), "pairs_above_event_limit": sum(
            n > indexes["eventos"].get(e, {}).get("limite_por_cuenta", n)
            for (_, e), n in usage.items())}

    edges = {}
    cases = meta.get("casos_borde", {})
    if isinstance(cases, dict):
        case = cases.get("zona_ultimas_50", {})
        if isinstance(case, dict):
            zone = indexes["zonas"].get(case.get("zona_id"), {})
            remaining = zone.get("aforo", 0) - occupied[case.get("zona_id")]
            edges["zona_ultimas_50"] = {"zone_exists": bool(zone),
                "capacity_matches_metadata": zone.get("aforo") == case.get("aforo"),
                "event_matches_metadata": zone.get("evento_id") == case.get("evento_id"),
                "derived_remaining": remaining, "expected_remaining": case.get("restantes")
                if integer(case.get("restantes")) else None,
                "matches": bool(zone) and remaining == case.get("restantes")}
        entry = indexes["entradas"].get(cases.get("entrada_usada"), {})
        edges["entrada_usada"] = {"exists": bool(entry), "is_used": entry.get("estado") == "usada",
                                  "valid_scan_count": valid_scans[entry.get("id")]}
        transfer = indexes["transferencias"].get(cases.get("transferencia_pendiente"), {})
        edges["transferencia_pendiente"] = {"exists": bool(transfer),
            "is_pending": transfer.get("estado") == "pendiente",
            "resolution_is_null": bool(transfer) and transfer.get("resuelta_en") is None}
        case = cases.get("limite_por_cuenta_alcanzado", {})
        if isinstance(case, dict):
            edges["limite_por_cuenta_alcanzado"] = {
                "nonrefunded_original_buyer_ticket_count": purchased[(case.get("asistente_id"), case.get("evento_id"))],
                "expected_limit": case.get("limite") if integer(case.get("limite")) else None,
                "matches": purchased[(case.get("asistente_id"), case.get("evento_id"))] == case.get("limite")}
        case = cases.get("evento_de_otro_organizador", {})
        if isinstance(case, dict):
            event = indexes["eventos"].get(case.get("evento_ajeno_id"), {})
            edges["evento_de_otro_organizador"] = {"event_exists": bool(event),
                "organizer_exists": case.get("organizador_id") in indexes["organizadores"],
                "owner_is_different": bool(event) and event.get("organizador_id") != case.get("organizador_id")}

    totals = {state: {"purchases": sum(r.get("estado") == state for r in rows["compras"]),
                       "quantity": sum(r.get("cantidad", 0) for r in rows["compras"]
                                       if r.get("estado") == state and integer(r.get("cantidad"))),
                       "amount_cents": sum(r.get("monto_centesimos", 0) for r in rows["compras"]
                                           if r.get("estado") == state and integer(r.get("monto_centesimos")))}
              for state in ("pagada", "reembolsada")}
    confirmed = [c for c in checks if c["count"] and c["classification_if_nonzero"] == "confirmed_defect"]
    observations = [c for c in checks if c["count"] and c["classification_if_nonzero"] == "contract_to_confirm"]
    return {
        "audit_version": 1, "input_sha256": hashlib.sha256(raw).hexdigest(),
        "input_bytes": len(raw), "read_only": True,
        "reference_timestamp": reference.isoformat() if reference else None,
        "currency_is_usd": meta.get("moneda") == "USD",
        "unit_is_integer_cents": meta.get("unidad_monetaria") == "centesimos (entero)",
        "counts": counts, "total_records": sum(counts.values()), "schema": schema,
        "sensitive_field_presence": pii, "password_representation_counts": password_counts,
        "known_enum_counts": enums,
        "duplicate_counts": duplicate_counts, "checks": checks,
        "summary": {"checks_run": len(checks), "confirmed_defect_checks": len(confirmed),
                    "confirmed_defect_affected_rows_across_checks": sum(c["count"] for c in confirmed),
                    "contract_observation_checks": len(observations)},
        "pricing_totals": totals, "timestamp_summary": timestamps,
        "phase_intervals": phase_intervals, "zone_inventory": stock,
        "inventory_assumption": "pagada, transferida and usada consume capacity; reembolsada releases it",
        "live_active_reservation_count_at_reference": len(available_reservations),
        "reservation_duration_seconds_counts": dict(sorted(reservation_durations.items())),
        "account_limit_scenarios": quota, "metadata_edge_cases": edges,
        "limitations": [
            "Fixture consistency cannot prove transactional safety, authorization or offline behavior.",
            "Expected enums and half-open price intervals require the official assignment contract.",
            "Reservations have no purchase link, price snapshot or idempotency key.",
            "Duplicate email/key counts do not prove uniqueness scope or authentication safety.",
            "No signing keys, credentials, device records, revocation versions or incidents are modeled.",
            "No amount represents an external payment-provider charge; all totals are fixture arithmetic.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path, help="External JSON fixture; read only")
    args = parser.parse_args()
    try:
        result = audit(args.dataset.read_bytes())
    except (OSError, UnicodeError, ValueError, TypeError, KeyError):
        # Never echo parser exceptions or paths: they can contain input data.
        print(json.dumps({"error": "Unreadable JSON or unsupported dataset structure; no input values disclosed."}))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 1 if result["summary"]["confirmed_defect_checks"] else 0


if __name__ == "__main__":
    sys.exit(main())
