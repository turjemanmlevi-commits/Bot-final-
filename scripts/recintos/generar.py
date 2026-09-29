# Uso: python3 scripts/recintos/generar.py   (vuelve a crear las carpetas de los recintos de datos.py en vault/10 Recintos)
# Genera las notas del vault (recinto, zonas y secciones) de datos.py.
import os, re, shutil, sys, unicodedata
sys.path.insert(0, os.path.dirname(__file__))
from datos import STADIUMS, CONCERT_STADIUMS, ARENAS, BULLRINGS, FESTIVALS, SRC_LALIGA, SRC_ARENAS

VAULT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "vault")
BASE = os.path.join(VAULT, "10 Recintos")
TODAY = "2026-09-29"
ORIENT = "sectores, filas y asientos exactos: en el plano oficial de cada venta"


def slug(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def q(s):
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


def fm(d):
    out = ["---"]
    for k, v in d.items():
        if v is None:
            continue
        if isinstance(v, bool):
            out.append(f"{k}: {'true' if v else 'false'}")
        elif isinstance(v, (int, float)):
            out.append(f"{k}: {v}")
        elif isinstance(v, list):
            if not v:
                out.append(f"{k}: []")
            else:
                out.append(f"{k}:")
                out.extend(f"  - {q(x)}" for x in v)
        else:
            out.append(f"{k}: {q(v)}")
    out.append("---")
    return "\n".join(out) + "\n"


def uniq(items, exclude=()):
    seen, out = {slug(x) for x in exclude}, []
    for x in items:
        k = slug(x)
        if k and k not in seen:
            seen.add(k)
            out.append(x)
    return out


def fmt_int(n):
    return f"{n:,}".replace(",", ".")


TIER_SHORT = {
    "Grada baja": ["baja", "inferior"],
    "Grada media": ["media"],
    "Grada alta": ["alta", "superior"],
    "Primera grada": ["1a grada", "primera graderia", "1a graderia"],
    "Segunda grada": ["2a grada", "segunda graderia", "2a graderia"],
    "Tercera grada": ["3a grada", "tercera graderia", "3a graderia"],
}
TIER_TEXT = {
    None: "Un solo nivel en este plano.",
    "Grada baja": "Nivel más cercano al campo.",
    "Grada media": "Nivel intermedio.",
    "Grada alta": "Nivel más alto: más lejos del campo y normalmente más barato.",
    "Primera grada": "1.ª grada: la más cercana al campo.",
    "Segunda grada": "2.ª grada: nivel intermedio.",
    "Tercera grada": "3.ª grada: la más alta.",
}
ROLE_TEXT = {
    "main": "Grada principal, a lo largo del campo.",
    "opp": "Grada lateral enfrente de la principal, a lo largo del campo.",
    "end": "Grada detrás de una de las porterías.",
}
POS_TEXT = {
    "Izquierda": "a la izquierda del escenario (según se mira al escenario)",
    "Central": "enfrente del escenario",
    "Derecha": "a la derecha del escenario (según se mira al escenario)",
}
POS_CA = {"Izquierda": "esquerra", "Central": "central", "Derecha": "dreta"}


# Otros nombres con los que aparece el club en los calendarios (football-data.org).
CLUB_ALT = {
    "RC Celta": ["RC Celta de Vigo"],
    "RC Deportivo": ["Deportivo de La Coruña"],
    "RCD Espanyol": ["RCD Espanyol de Barcelona"],
    "Racing de Santander": ["Real Racing Club de Santander"],
    "Real Betis": ["Real Betis Balompié"],
    "Real Sociedad": ["Real Sociedad de Fútbol"],
    "Rayo Vallecano": ["Rayo Vallecano de Madrid"],
    "Atlético de Madrid": ["Club Atlético de Madrid"],
}


class Venue:
    def __init__(self, vid, name, city, kind_tag, source, aliases, capacity=None, tags=(), club=None):
        self.vid, self.name, self.city, self.kind_tag, self.source = vid, name, city, kind_tag, source
        self.aliases, self.capacity, self.tags = aliases, capacity, list(tags)
        self.clubs = ([club] + CLUB_ALT.get(club, [])) if club else None
        self.zones = []  # (name, desc, aliases, [sections])

    def link(self):
        return f"[[10 Recintos/{self.name}/{self.name}|{self.name}]]"

    def zlink(self, zone):
        return f"[[10 Recintos/{self.name}/Zonas/{zone}|{zone}]]"

    def add_zone(self, name, desc, aliases=(), sections=()):
        self.zones.append({"name": name, "desc": desc, "aliases": list(aliases), "sections": list(sections)})

    def write(self, intro, howto):
        folder = os.path.join(BASE, self.name)
        if os.path.exists(folder):
            shutil.rmtree(folder)
        os.makedirs(os.path.join(folder, "Zonas"))
        os.makedirs(os.path.join(folder, "Secciones"))
        files = 0
        zone_lines = []
        for i, zn in enumerate(self.zones, start=1):
            zone_lines.append(f"- {self.zlink(zn['name'])} — {zn['desc']}")
            sec_lines = "\n".join(f"- [[10 Recintos/{self.name}/Secciones/{s['name']}|{s['name']}]]" for s in zn["sections"])
            with open(os.path.join(folder, "Zonas", f"{zn['name']}.md"), "w", encoding="utf-8") as f:
                f.write(fm({"type": "zone", "id": f"{self.vid}.zona-{i}-{slug(zn['name'])}", "venue": self.link(), "name": zn["name"],
                            "aliases": uniq(zn["aliases"], [zn["name"]]), "tags": ["zona"]}))
                f.write(f"\n# {zn['name']}\n\n{zn['desc']} Zona de {self.link()}.\n\n## Secciones\n\n{sec_lines}\n")
            files += 1
            for s in zn["sections"]:
                with open(os.path.join(folder, "Secciones", f"{s['name']}.md"), "w", encoding="utf-8") as f:
                    f.write(fm({"type": "section", "venue": self.link(), "zone": self.zlink(zn["name"]), "name": s["name"],
                                "level": s.get("level"), "kind": s["kind"], "aliases": uniq(s.get("aliases", []), [s["name"]]),
                                "accessible": s.get("accessible"), "source": self.source, "verifiedAt": TODAY, "confidence": 0.7,
                                "tags": ["seccion"]}))
                    f.write(f"\n# {s['name']}\n\n{s['text']} Zona {self.zlink(zn['name'])} de {self.link()}.\n\nSectores, filas y asientos: en el plano oficial de cada venta.\n")
                files += 1
        cap = f" · {fmt_int(self.capacity)} localidades" if self.capacity else ""
        base_block = ""
        if "'" not in self.name:
            base_block = (
                "\n## Secciones\n\n```base\nfilters:\n  and:\n    - 'note.type == \"section\"'\n"
                f"    - 'file.inFolder(\"10 Recintos/{self.name}\")'\n"
                "views:\n  - type: table\n    name: Secciones\n    order:\n      - file.name\n      - note.zone\n      - note.level\n      - note.kind\n```\n"
            )
        with open(os.path.join(folder, f"{self.name}.md"), "w", encoding="utf-8") as f:
            f.write(fm({"type": "venue", "id": self.vid, "name": self.name, "city": self.city, "club": self.clubs, "capacity": self.capacity,
                        "aliases": uniq(self.aliases, [self.name]), "source": self.source, "verifiedAt": TODAY, "verifiedBy": "asistente",
                        "confidence": 0.7, "tags": ["recinto", "real", self.kind_tag] + self.tags}))
            f.write(f"\n# {self.name}\n\n**{self.city}**{cap}. {intro}\n\n## Cómo leer el plano\n\n{howto}\n\n## Zonas\n\n" + "\n".join(zone_lines) + "\n\n")
            f.write(f"> [!info] Plano orientativo\n> Gradas, niveles y zonas para coordinar la compra y enseñar al cliente dónde irá. {ORIENT[0].upper() + ORIENT[1:]}.\n\n")
            f.write(f"Fuente: {self.source}\n{base_block}")
        return files + 1


def pista_sections(prefix="Pista"):
    return [
        {"name": f"{prefix} · Front Stage", "kind": "STANDING", "text": "De pie, delante del escenario: lo primero que se agota.",
         "aliases": ["Front Stage", f"{prefix} Front Stage", f"{prefix} delantera", "Golden", f"{prefix} Golden", "Golden Circle", f"{prefix} A"]},
        {"name": f"{prefix} · General", "kind": "STANDING", "text": "De pie, detrás del Front Stage.",
         "aliases": [f"{prefix} general", f"{prefix} trasera", f"{prefix} B", "General", "Pista" if prefix != "Pista" else "Pista general"]},
    ]


def stadium(d, laliga=True):
    src = (SRC_LALIGA if laliga else "Estadio de conciertos de Barcelona (nombres habituales de sus gradas)") + ". Gradas y niveles: estructura orientativa con los nombres habituales del estadio; " + ORIENT + "."
    v = Venue(d["id"], d["name"], d["city"], "estadio", src, d["aliases"], d.get("capacity"), ["laliga"] if laliga else [], d.get("club"))
    if d.get("concerts"):
        v.tags.append("conciertos")
        v.add_zone("Pista (conciertos)", "Solo en conciertos: de pie sobre el césped.", ["Pista", "Pista conciertos"], pista_sections())
    tiers_all = []
    for zd in d["zones"]:
        secs = []
        for t in zd["tiers"]:
            if t is None:
                secs.append({"name": zd["name"], "kind": "SEATED", "text": TIER_TEXT[None], "aliases": list(zd["aliases"])})
                continue
            if t not in tiers_all:
                tiers_all.append(t)
            names = [zd["name"]] + zd["aliases"]
            al = []
            for n in names:
                al += [f"{n} · {t}", f"{n} {t}"] + [f"{n} {s}" for s in TIER_SHORT.get(t, [])]
            secs.append({"name": f"{zd['name']} · {t}", "level": t, "kind": "SEATED", "text": TIER_TEXT[t], "aliases": al})
        v.add_zone(zd["name"], ROLE_TEXT[zd["role"]], zd["aliases"], secs)
    mains = [zd["name"] for zd in d["zones"] if zd["role"] in ("main", "opp")]
    ends = [zd["name"] for zd in d["zones"] if zd["role"] == "end"]
    howto = [f"- **{' y '.join(mains)}**: gradas laterales, a lo largo del campo (la mejor vista del partido)."]
    if ends:
        howto.append(f"- **{' y '.join(ends)}**: detrás de las porterías." + (" En conciertos el escenario suele ir en un fondo." if d.get("concerts") else ""))
    if tiers_all:
        howto.append(f"- **Niveles**, del campo hacia arriba: {', '.join(tiers_all)}.")
    else:
        howto.append("- Cada grada va como un solo nivel en este plano.")
    if d.get("concerts"):
        howto.append("- **Pista (conciertos)**: de pie sobre el césped. *Front Stage* = delante del escenario; *General* = detrás.")
    who = f"Estadio del **{d['club']}** (LaLiga 2026-27). Fútbol: entradas en la web oficial del club." if d.get("club") else ""
    extra = " " + d["note"] if d.get("note") else ""
    conc = " Acoge grandes conciertos (la venta suele ser en Ticketmaster, entradas.com u otra ticketera oficial del evento)." if d.get("concerts") and not d.get("note") else ""
    return v, (who + extra + conc).strip(), "\n".join(howto)


def arena(d):
    src = SRC_ARENAS + ". Pista y gradas: estructura orientativa de un pabellón en formato concierto; " + ORIENT + "."
    v = Venue(d["id"], d["name"], d["city"], "pabellon", src, d["aliases"], d.get("capacity"), ["conciertos"])
    v.add_zone("Pista", "De pie, delante del escenario.", ["Pista general", "Floor"], pista_sections())
    for zname, lvl, extra_al in (("Grada baja", "Nivel 1", ["Grada inferior"]), ("Grada alta", "Nivel 2", ["Grada superior"])):
        secs = []
        for pos in ("Izquierda", "Central", "Derecha"):
            al = [f"{zname} {pos}", f"{extra_al[0]} {pos}", f"{lvl} {pos}"]
            if d.get("catalan"):
                al.append(f"Graderia {'baixa' if zname == 'Grada baja' else 'alta'} {POS_CA[pos]}")
            secs.append({"name": f"{zname} · {pos}", "level": lvl, "kind": "SEATED", "text": f"{zname}, {POS_TEXT[pos]}.", "aliases": al})
        v.add_zone(zname, ("Primer anillo de asientos, alrededor de la pista." if zname == "Grada baja" else "Anillo superior: más lejos y normalmente más barato."),
                   [f"{zname} {lvl}", lvl] + extra_al, secs)
        if zname == "Grada baja" and d.get("palcos"):
            v.add_zone("Palcos", "Palcos y zona VIP.", ["VIP", "Palcos VIP"], [{"name": "Palcos", "kind": "SEATED", "text": "Palcos y asientos VIP.", "aliases": ["Palco", "VIP", "Palcos VIP"]}])
    conc = f" En conciertos, hasta unas {fmt_int(d['concert'])} personas." if d.get("concert") else ""
    intro = "Pabellón multiusos para grandes conciertos." + conc + (" " + d["extra"] if d.get("extra") and "concierto" not in d["extra"] else "")
    howto = "\n".join([
        "- **Pista**: de pie. *Front Stage* = delante del escenario; *General* = detrás.",
        "- **Grada baja** (nivel 1) y **Grada alta** (nivel 2): sentado, alrededor de la pista.",
        "- **Izquierda / Central / Derecha**: según se mira al escenario; *Central* = enfrente del escenario.",
    ] + (["- **Palcos**: asientos VIP entre las dos gradas."] if d.get("palcos") else []))
    return v, intro, howto


def bullring(d):
    src = (d.get("src") or "Plaza de toros de Madrid") + ". Ruedo y tendidos: estructura orientativa de una plaza de toros en formato concierto; " + ORIENT + "."
    v = Venue(d["id"], d["name"], d["city"], "plaza-de-toros", src, d["aliases"], d.get("capacity"), ["conciertos"])
    v.add_zone("Ruedo", "Pista de pie en el ruedo, delante del escenario.", ["Pista", "Ruedo pista"], pista_sections("Ruedo"))
    for zname, desc in (("Tendido", "Primeros asientos, junto al ruedo."), ("Grada", "Nivel intermedio."), ("Andanada", "Nivel más alto.")):
        secs = [{"name": f"{zname} · {pos}", "kind": "SEATED", "text": f"{zname}, {POS_TEXT[pos]}.", "aliases": [f"{zname} {pos}", f"{zname}s {pos}"]} for pos in ("Izquierda", "Central", "Derecha")]
        v.add_zone(zname, desc, [f"{zname}s"], secs)
    intro = ("Plaza de toros cubierta que acoge conciertos." if d.get("covered") else "Plaza de toros que acoge grandes conciertos.") + (" " + d["extra"] if d.get("extra") else "")
    howto = "\n".join([
        "- **Ruedo**: de pie delante del escenario (*Front Stage* y *General*).",
        "- **Tendido** (abajo), **Grada** (medio) y **Andanada** (arriba): sentado.",
        "- **Izquierda / Central / Derecha**: según se mira al escenario.",
    ])
    return v, intro, howto


def festival(d):
    src = d["src"] + ". Zonas típicas de un festival (pista general, front stage y VIP según la venta); " + ORIENT + "."
    v = Venue(d["id"], d["name"], d["city"], "festival", src, d["aliases"], d.get("perDay"), ["conciertos"])
    v.add_zone("Pista", "Recinto de pie delante de los escenarios.", ["Pista general", "General"], pista_sections())
    v.add_zone("VIP", "Zona VIP (según la venta: acceso preferente, barra y aseos propios).", ["Zona VIP"],
               [{"name": "VIP", "kind": "STANDING", "text": "Entrada VIP de pie.", "aliases": ["Zona VIP", "Entrada VIP", "VIP Experience"]}])
    v.add_zone("Zona PMR", "Plataforma para personas con movilidad reducida.", ["PMR"],
               [{"name": "Zona PMR", "kind": "STANDING", "accessible": True, "text": "Plataforma accesible (solo si alguien del grupo la necesita).", "aliases": ["PMR", "Plataforma PMR", "Movilidad reducida"]}])
    intro = "Recinto de grandes festivales y fiestas. " + d["events"]
    howto = "\n".join([
        "- **Pista**: de pie. *Front Stage* = delante del escenario principal (si la venta lo ofrece); *General* = el resto del recinto.",
        "- **VIP**: entrada VIP de pie (si la venta la ofrece).",
        "- **Zona PMR**: plataforma accesible, solo para quien la necesite.",
    ])
    if d.get("perDay"):
        v.capacity = d["perDay"]
    return v, intro, howto


total_files = 0
made = []
for d in STADIUMS:
    v, intro, howto = stadium(d, True); total_files += v.write(intro, howto); made.append(v.name)
for d in CONCERT_STADIUMS:
    v, intro, howto = stadium(d, False); total_files += v.write(intro, howto); made.append(v.name)
for d in ARENAS:
    v, intro, howto = arena(d); total_files += v.write(intro, howto); made.append(v.name)
for d in BULLRINGS:
    v, intro, howto = bullring(d); total_files += v.write(intro, howto); made.append(v.name)
for d in FESTIVALS:
    v, intro, howto = festival(d); total_files += v.write(intro, howto); made.append(v.name)
print(f"{len(made)} recintos, {total_files} notas")
