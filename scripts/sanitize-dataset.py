#!/usr/bin/env python3
"""Create a deterministic, synthetic seed from the external ticketing fixture.

The output uses explicit whitelists. Password fields are omitted, names, emails,
venues and codes are synthetic, and operational UUIDs are regenerated from
numeric IDs. Business IDs/FKs, states, amounts, dates and edge cases are retained.
The original is read only; stdout contains only aggregate provenance.
"""

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import sys
import uuid


FIELDS = {
    "usuarios_administrativos": "id nombre email rol activo",
    "organizadores": "id nombre email rol activo",
    "staff": "id nombre email rol organizador_id activo",
    "asistentes": "id nombre email rol creado_en",
    "eventos": "id codigo nombre organizador_id fecha venta_abre limite_por_cuenta estado reembolsable_hasta recinto",
    "zonas": "id evento_id nombre aforo",
    "fases_precio": "id zona_id fase precio_centesimos desde hasta",
    "puertas": "id evento_id nombre",
    "asignaciones_staff": "evento_id staff_id",
    "compras": "id asistente_id evento_id zona_id fase_precio_id cantidad precio_unitario_centesimos monto_centesimos idempotency_key estado pagada_en reembolsada_en",
    "entradas": "id compra_id evento_id zona_id titular_id comprador_id estado emitida_en",
    "transferencias": "id entrada_id de_usuario_id a_usuario_id estado creada_en resuelta_en",
    "ingresos": "id entrada_id evento_id puerta_id staff_id client_scan_id escaneado_en sincronizado_en resultado",
    "reservas": "id asistente_id zona_id cantidad creada_en expira_en estado",
}
IDENTITIES = {
    "usuarios_administrativos": ("admin", "Administrador"),
    "organizadores": ("organizador", "Organizador"),
    "staff": ("staff", "Staff"),
    "asistentes": ("asistente", "Asistente"),
}
NAMED_BUSINESS = {"eventos": "Evento", "zonas": "Zona", "puertas": "Puerta"}
ENUMS = {
    "eventos": {"estado": {"finalizado", "en_venta", "proximo"}},
    "fases_precio": {"fase": {"preventa", "general", "taquilla"}},
    "compras": {"estado": {"pagada", "reembolsada"}},
    "entradas": {"estado": {"pagada", "transferida", "usada", "reembolsada"}},
    "transferencias": {"estado": {"aceptada", "pendiente", "cancelada", "rechazada"}},
    "ingresos": {"resultado": {"valido", "invalido", "duplicado"}},
    "reservas": {"estado": {"activa", "expirada", "confirmada", "cancelada"}},
}
DATES = {"creado_en", "fecha", "venta_abre", "reembolsable_hasta", "desde", "hasta",
         "pagada_en", "reembolsada_en", "emitida_en", "creada_en", "resuelta_en",
         "escaneado_en", "sincronizado_en", "expira_en"}
NULLABLE_DATES = {"reembolsada_en", "resuelta_en"}
NUMERIC = {"cantidad", "precio_unitario_centesimos", "monto_centesimos", "aforo",
           "limite_por_cuenta", "precio_centesimos"}
UUID_NAMESPACE = uuid.UUID("087b08f1-86bb-5960-8f82-9238e43291e8")
EDGE_FIELDS = {
    "zona_ultimas_50": ("evento_id", "zona_id", "aforo", "restantes"),
    "limite_por_cuenta_alcanzado": ("asistente_id", "evento_id", "limite"),
    "evento_de_otro_organizador": ("organizador_id", "evento_ajeno_id"),
}


def integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


def valid_date(value):
    if not isinstance(value, str):
        return False
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).tzinfo is not None
    except ValueError:
        return False


def unique_object(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError("duplicate_object_key")
        obj[key] = value
    return obj


def sanitize(raw):
    data = json.loads(raw, object_pairs_hook=unique_object)
    if not isinstance(data, dict) or not isinstance(data.get("meta"), dict):
        raise ValueError("root")
    output = {}
    replaced = {field: 0 for field in ("nombre", "email", "recinto", "codigo",
                                      "idempotency_key", "client_scan_id")}
    removed_passwords = 0
    for table, columns in FIELDS.items():
        if not isinstance(data.get(table), list):
            raise ValueError("table")
        allowed = columns.split()
        output[table] = []
        for row in data[table]:
            if not isinstance(row, dict) or any(field not in row for field in allowed):
                raise ValueError("row")
            if set(row) - set(allowed) - {"password"}:
                raise ValueError("unsupported_field")
            if "password" in row:
                removed_passwords += 1
            target = {}
            for field in allowed:
                value = row[field]
                if field == "id" or field.endswith("_id"):
                    # client_scan_id is a UUID rather than a numeric relationship.
                    if field != "client_scan_id" and (not integer(value) or value <= 0):
                        raise ValueError("numeric_id")
                if field == "nombre":
                    label = IDENTITIES[table][1] if table in IDENTITIES else NAMED_BUSINESS[table]
                    value = f"{label} de prueba {row['id']:04d}"
                    replaced[field] += 1
                elif field == "email":
                    value = f"{IDENTITIES[table][0]}.{row['id']}@example.test"
                    replaced[field] += 1
                elif field == "recinto":
                    value = f"Recinto de prueba {row['id']:04d}"
                    replaced[field] += 1
                elif field == "codigo":
                    value = f"EVENTO-{row['id']:04d}"
                    replaced[field] += 1
                elif field in ("idempotency_key", "client_scan_id"):
                    value = str(uuid.uuid5(UUID_NAMESPACE, f"{table}:{row['id']}:{field}"))
                    replaced[field] += 1
                elif field == "rol":
                    if value != IDENTITIES[table][0]:
                        raise ValueError("role")
                elif field in ENUMS.get(table, {}):
                    if value not in ENUMS[table][field]:
                        raise ValueError("enum")
                elif field == "activo":
                    if not isinstance(value, bool):
                        raise ValueError("boolean")
                elif field in DATES:
                    if not (value is None and field in NULLABLE_DATES) and not valid_date(value):
                        raise ValueError("date")
                elif field in NUMERIC:
                    if not integer(value) or value < 0:
                        raise ValueError("numeric")
                target[field] = value
            output[table].append(target)

    meta = data["meta"]
    if meta.get("moneda") != "USD" or meta.get("unidad_monetaria") != "centesimos (entero)":
        raise ValueError("currency")
    if not valid_date(meta.get("referencia_temporal")):
        raise ValueError("reference")
    if not integer(meta.get("version")):
        raise ValueError("version")
    cases = meta.get("casos_borde")
    if not isinstance(cases, dict):
        raise ValueError("cases")
    safe_cases = {}
    for case, fields in EDGE_FIELDS.items():
        if not isinstance(cases.get(case), dict) or any(not integer(cases[case].get(f)) for f in fields):
            raise ValueError("numeric_case")
        safe_cases[case] = {f: cases[case][f] for f in fields}
    for case in ("entrada_usada", "transferencia_pendiente"):
        if not integer(cases.get(case)):
            raise ValueError("numeric_case")
        safe_cases[case] = cases[case]
    counts = {table: len(records) for table, records in output.items()}
    if meta.get("conteos") != counts:
        raise ValueError("metadata_counts")
    safe_meta = {
        "prueba": "02-ticketing-acceso", "version": meta["version"], "moneda": "USD",
        "unidad_monetaria": "centesimos (entero)",
        "referencia_temporal": meta["referencia_temporal"],
        "estados_entrada": {
            "pagada": "vigente, en manos del comprador",
            "transferida": "vigente, en manos de otro usuario por transferencia aceptada",
            "usada": "ya ingreso al evento",
            "reembolsada": "anulada por reembolso; libera cupo",
        },
        "nota": "La disponibilidad de cada zona no se entrega: se deriva de aforo menos entradas vigentes.",
        "casos_borde": safe_cases, "conteos": counts,
    }
    seed = {"meta": safe_meta, **output}
    encoded = (json.dumps(seed, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    report = {"sanitizer_version": 1, "source_sha256": hashlib.sha256(raw).hexdigest(),
              "output_sha256": hashlib.sha256(encoded).hexdigest(), "output_bytes": len(encoded),
              "counts": counts, "password_fields_removed": removed_passwords,
              "synthetic_fields_replaced": replaced,
              "business_fields_preserved": "numeric IDs/FKs, states, amounts, dates and edge-case references",
              "operational_uuid_policy": "deterministic UUIDv5 from table, numeric ID and field name; original values discarded"}
    return encoded, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path, help="External original dataset; never modified")
    parser.add_argument("--output", type=Path, required=True, help="Destination for the synthetic seed")
    args = parser.parse_args()
    try:
        if args.dataset.resolve() == args.output.resolve():
            raise ValueError("cannot_overwrite_source")
        encoded, report = sanitize(args.dataset.read_bytes())
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(encoded)
    except (OSError, UnicodeError, ValueError, TypeError, KeyError):
        print(json.dumps({"error": "Input rejected or output unavailable; original values are never disclosed."}))
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
