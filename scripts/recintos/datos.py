# Recintos reales de España: LaLiga 2026-27, pabellones grandes, plazas de toros y
# recintos de festivales / feriales. Estructura orientativa (gradas y niveles).

SRC_LALIGA = "LaLiga 2026-27: club, estadio y aforo según es.wikipedia.org/wiki/Primera_División_de_España_2026-27 (consultado el 29-09-2026)"
SRC_ARENAS = "Aforo según en.wikipedia.org/wiki/List_of_indoor_arenas_in_Spain (consultado el 29-09-2026)"

T1 = [None]
T2 = ["Grada baja", "Grada alta"]
T3 = ["Grada baja", "Grada media", "Grada alta"]
TCN = ["Primera grada", "Segunda grada", "Tercera grada"]


def z(name, tiers, role, aliases=()):
    return {"name": name, "tiers": tiers, "role": role, "aliases": list(aliases)}


def std(t=T1, t_end=None, main="Tribuna", opp="Preferencia", end1="Fondo Norte", end2="Fondo Sur", a1=("Gol Norte",), a2=("Gol Sur",), a_opp=()):
    return [z(main, t, "main"), z(opp, t, "opp", a_opp), z(end1, t_end or t, "end", a1), z(end2, t_end or t, "end", a2)]


STADIUMS = [
    dict(id="estadio-de-mendizorroza", name="Estadio de Mendizorroza", city="Vitoria-Gasteiz", capacity=19840, club="Deportivo Alavés",
         aliases=["Mendizorroza"], zones=std()),
    dict(id="san-mames", name="San Mamés", city="Bilbao", capacity=53289, club="Athletic Club",
         aliases=["Estadio San Mamés", "San Mames"], concerts=True,
         zones=[z("Tribuna Principal", T2, "main"), z("Tribuna Este", T2, "opp"), z("Fondo Norte", T2, "end", ["Tribuna Norte"]), z("Fondo Sur", T2, "end", ["Tribuna Sur"])]),
    dict(id="riyadh-air-metropolitano", name="Riyadh Air Metropolitano", city="Madrid", capacity=70460, club="Atlético de Madrid",
         aliases=["Metropolitano", "Estadio Metropolitano", "Cívitas Metropolitano", "Wanda Metropolitano"], concerts=True,
         zones=[z("Lateral Oeste", T3, "main"), z("Lateral Este", T2, "opp"), z("Fondo Norte", T2, "end"), z("Fondo Sur", T2, "end")]),
    dict(id="spotify-camp-nou", name="Spotify Camp Nou", city="Barcelona", capacity=99354, club="FC Barcelona",
         aliases=["Camp Nou", "Estadi Camp Nou", "Nou Camp"], concerts=True,
         zones=[z("Tribuna", TCN, "main"), z("Lateral", TCN, "opp"), z("Gol Norte", TCN, "end", ["Gol Nord"]), z("Gol Sur", TCN, "end", ["Gol Sud"])]),
    dict(id="abanca-balaidos", name="Abanca-Balaídos", city="Vigo", capacity=24870, club="RC Celta",
         aliases=["Balaídos", "Estadio de Balaídos", "Balaidos"],
         zones=[z("Tribuna", T1, "main"), z("Río", T1, "opp", ["Rio", "Preferencia"]), z("Marcador", T1, "end"), z("Gol", T1, "end")]),
    dict(id="abanca-riazor", name="Abanca-Riazor", city="A Coruña", capacity=32490, club="RC Deportivo",
         aliases=["Riazor", "Estadio de Riazor"],
         zones=[z("Tribuna", T1, "main"), z("Preferencia", T1, "opp"), z("Fondo Maratón", T1, "end", ["Maratón", "Marathon", "Marathón", "Maraton"]), z("Fondo Pabellón", T1, "end", ["Pabellón", "Pabellon"])]),
    dict(id="estadio-manuel-martinez-valero", name="Estadio Manuel Martínez Valero", city="Elche", capacity=33732, club="Elche CF",
         aliases=["Martínez Valero", "Martinez Valero"], zones=std(T2)),
    dict(id="rcde-stadium", name="RCDE Stadium", city="Cornellà de Llobregat", capacity=40000, club="RCD Espanyol",
         aliases=["Estadio RCDE", "Cornellà-El Prat", "Estadi Cornellà-El Prat"],
         zones=[z("Tribuna", T2, "main"), z("Lateral", T2, "opp"), z("Fondo Cornellà", T1, "end", ["Gol Cornellà", "Gol Cornella"]), z("Fondo El Prat", T1, "end", ["Gol Prat", "Gol El Prat"])]),
    dict(id="coliseum-getafe", name="Coliseum (Getafe)", city="Getafe", capacity=16500, club="Getafe CF",
         aliases=["Coliseum Alfonso Pérez", "Estadio Coliseum", "Coliseum Getafe"], zones=std()),
    dict(id="estadi-ciutat-de-valencia", name="Estadi Ciutat de València", city="Valencia", capacity=26354, club="Levante UD",
         aliases=["Ciutat de València", "Ciudad de Valencia", "Estadio Ciudad de Valencia"],
         zones=std(a1=("Gol Norte", "Gol Nord"), a2=("Gol Sur", "Gol Sud"))),
    dict(id="estadio-la-rosaleda", name="Estadio La Rosaleda", city="Málaga", capacity=30778, club="Málaga CF",
         aliases=["La Rosaleda", "Rosaleda"], zones=std()),
    dict(id="estadio-el-sadar", name="Estadio El Sadar", city="Pamplona", capacity=23576, club="CA Osasuna",
         aliases=["El Sadar", "Sadar"], zones=std(T2, main="Tribuna Principal", end1="Gol Norte", end2="Gol Sur", a1=("Fondo Norte",), a2=("Fondo Sur",))),
    dict(id="estadio-el-sardinero", name="Estadio El Sardinero", city="Santander", capacity=22514, club="Racing de Santander",
         aliases=["El Sardinero", "Campos de Sport de El Sardinero", "Sardinero"], zones=std()),
    dict(id="estadio-de-vallecas", name="Estadio de Vallecas", city="Madrid", capacity=14708, club="Rayo Vallecano",
         aliases=["Vallecas", "Campo de Fútbol de Vallecas"],
         zones=[z("Tribuna", T1, "main"), z("Preferencia", T1, "opp"), z("Fondo", T1, "end", ["Gol"])],
         note="Tiene gradas en tres lados: detrás de una de las porterías no hay grada."),
    dict(id="estadio-de-la-cartuja", name="Estadio de La Cartuja", city="Sevilla", capacity=68887, club="Real Betis",
         aliases=["La Cartuja", "Estadio Olímpico de La Cartuja", "Estadio Olímpico de Sevilla", "Cartuja"], concerts=True, zones=std(T2),
         note="En 2026-27 juega aquí el Real Betis mientras se reconstruye el Benito Villamarín. Acoge grandes conciertos y festivales: Puro Latino Fest Sevilla 2026 (3 y 4 de julio, según estadiolacartuja.es)."),
    dict(id="reale-arena", name="Reale Arena", city="San Sebastián", capacity=39313, club="Real Sociedad",
         aliases=["Anoeta", "Estadio de Anoeta", "Reale Arena Anoeta"], concerts=True, zones=std(T2)),
    dict(id="estadio-ramon-sanchez-pizjuan", name="Estadio Ramón Sánchez-Pizjuán", city="Sevilla", capacity=43883, club="Sevilla FC",
         aliases=["Sánchez-Pizjuán", "Sanchez Pizjuan", "Pizjuán", "Ramón Sánchez Pizjuán"],
         zones=std(T2, end1="Gol Norte", end2="Gol Sur", a1=("Fondo Norte",), a2=("Fondo Sur",))),
    dict(id="estadio-de-mestalla", name="Estadio de Mestalla", city="Valencia", capacity=49430, club="Valencia CF",
         aliases=["Mestalla"],
         zones=[z("Tribuna", T2, "main"), z("Grada Central", T2, "opp", ["Preferencia"]), z("Gol Mar", T2, "end"), z("Gol Gran Capità", T2, "end", ["Gol Gran Capitán", "Gol Gran Capita"])]),
    dict(id="estadio-de-la-ceramica", name="Estadio de la Cerámica", city="Villarreal", capacity=23500, club="Villarreal CF",
         aliases=["La Cerámica", "Estadio de La Cerámica", "El Madrigal"], zones=std()),
]

# Estadio para conciertos (no es de LaLiga 2026-27).
CONCERT_STADIUMS = [
    dict(id="estadi-olimpic-lluis-companys", name="Estadi Olímpic Lluís Companys", city="Barcelona", capacity=None, club=None,
         aliases=["Estadi Olímpic", "Estadio Olímpico de Barcelona", "Olímpic de Montjuïc", "Montjuïc"], concerts=True,
         zones=[z("Tribuna", T2, "main"), z("Lateral", T2, "opp"), z("Gol Norte", T2, "end", ["Gol Nord"]), z("Gol Sur", T2, "end", ["Gol Sud"])],
         note="Estadio de Montjuïc (Barcelona). El FC Barcelona jugó aquí de 2023 a 2025; hoy se usa sobre todo para grandes conciertos."),
]

ARENAS = [
    dict(id="movistar-arena", name="Movistar Arena", city="Madrid", capacity=15000, concert=20000, palcos=True,
         aliases=["WiZink Center", "Palacio de los Deportes", "Palacio de Deportes de la Comunidad de Madrid", "Barclaycard Center"],
         extra="Tras la ampliación anunciada en 2025 llega a unas 20.000 personas en conciertos (xataka.com, jenesaispop.com)."),
    dict(id="palau-sant-jordi", name="Palau Sant Jordi", city="Barcelona", capacity=16159, concert=17960, catalan=True,
         aliases=["Sant Jordi"], extra="En conciertos, hasta unas 17.960 personas (funksocialclub.com)."),
    dict(id="roig-arena", name="Roig Arena", city="Valencia", capacity=15600, concert=20000, palcos=True,
         aliases=["Roig Arena Valencia"], extra="Abierto en 2025: hasta 20.000 personas en conciertos."),
    dict(id="fernando-buesa-arena", name="Fernando Buesa Arena", city="Vitoria-Gasteiz", capacity=15504, aliases=["Buesa Arena"]),
    dict(id="bizkaia-arena-bec", name="Bizkaia Arena (BEC)", city="Barakaldo", capacity=15414,
         aliases=["Bizkaia Arena", "BEC", "Bilbao Exhibition Centre"], extra="Dentro del recinto ferial BEC (Bilbao Exhibition Centre)."),
    dict(id="palacio-vistalegre", name="Palacio Vistalegre", city="Madrid", capacity=14240, aliases=["Vistalegre", "Vistalegre Arena", "Palacio de Vistalegre"]),
    dict(id="navarra-arena", name="Navarra Arena", city="Pamplona", capacity=13613, aliases=[]),
    dict(id="palau-olimpic-de-badalona", name="Palau Olímpic de Badalona", city="Badalona", capacity=12760, catalan=True,
         aliases=["Olímpic de Badalona", "Pavelló Olímpic de Badalona"]),
    dict(id="caja-magica", name="Caja Mágica", city="Madrid", capacity=12427, aliases=["Estadio Manolo Santana", "Caja Magica"]),
    dict(id="illumbe", name="Illumbe", city="San Sebastián", capacity=11000, aliases=["Donostia Arena", "Illunbe"]),
    dict(id="pabellon-principe-felipe", name="Pabellón Príncipe Felipe", city="Zaragoza", capacity=10744, aliases=["Príncipe Felipe"]),
    dict(id="palacio-de-deportes-martin-carpena", name="Palacio de Deportes José María Martín Carpena", city="Málaga", capacity=10699,
         aliases=["Martín Carpena", "Martin Carpena", "Carpena"]),
    dict(id="madrid-arena", name="Madrid Arena", city="Madrid", capacity=10276, aliases=["Madrid Arena Casa de Campo"]),
    dict(id="bilbao-arena", name="Bilbao Arena", city="Bilbao", capacity=10014, aliases=["Miribilla", "Bilbao Arena Miribilla"]),
    dict(id="leon-arena", name="León Arena", city="León", capacity=10000, aliases=["Leon Arena"]),
    dict(id="gran-canaria-arena", name="Gran Canaria Arena", city="Las Palmas de Gran Canaria", capacity=9870, aliases=[]),
    dict(id="coliseum-burgos", name="Coliseum Burgos", city="Burgos", capacity=9604, aliases=[]),
    dict(id="coliseum-da-coruna", name="Coliseum da Coruña", city="A Coruña", capacity=9300, aliases=["Coliseum A Coruña", "Coliseum de A Coruña"]),
]

BULLRINGS = [
    dict(id="plaza-de-toros-de-las-ventas", name="Plaza de Toros de Las Ventas", city="Madrid", capacity=None,
         aliases=["Las Ventas", "Monumental de Las Ventas"], extra="Plaza de toros que acoge grandes conciertos (aforo de casi 24.000 localidades en toros)."),
    dict(id="la-cubierta-de-leganes", name="La Cubierta de Leganés", city="Leganés", capacity=10000, covered=True,
         aliases=["La Cubierta", "Plaza de toros La Cubierta"], src=SRC_ARENAS),
    dict(id="plaza-de-toros-de-la-ribera", name="Plaza de Toros de La Ribera", city="Logroño", capacity=11000, covered=True,
         aliases=["La Ribera", "Plaza de toros de Logroño"], src=SRC_ARENAS),
]

FESTIVALS = [
    dict(id="espacio-iberdrola-music", name="Espacio Iberdrola Music", city="Madrid (Villaverde)", perDay=80000,
         aliases=["Iberdrola Music", "Espacio Mad Cool", "Mad Cool"], events="Mad Cool Festival 2026 (8 a 11 de julio), unas 80.000 personas por día.",
         src="dodmagazine.es, eldiario.es y esmadrid.com (Mad Cool 2026); aforo diario según ifema.es (mejores festivales 2026)"),
    dict(id="parc-del-forum", name="Parc del Fòrum", city="Barcelona", aliases=["Fòrum", "Parc del Forum", "Recinte Fòrum"],
         events="Primavera Sound 2026 (junio) y otros grandes festivales.", src="primaverasound / en.wikipedia.org/wiki/Primavera_Sound_2026"),
    dict(id="kobetamendi", name="Kobetamendi", city="Bilbao", aliases=["Monte Kobetas", "Kobeta"],
         events="Bilbao BBK Live 2026 (9 a 11 de julio).", src="tourism.euskadi.eus y kulturklik.euskadi.eus (BBK Live 2026)"),
    dict(id="campus-de-cantoblanco-uam", name="Campus de Cantoblanco (UAM)", city="Madrid", aliases=["Cantoblanco", "UAM", "Universidad Autónoma de Madrid"],
         events="Puro Latino Madrid Fest 2026 (26 y 27 de junio).", src="esmadrid.com y festivalesdeespana.com (Puro Latino Madrid Fest 2026)"),
    dict(id="recinto-ferial-las-banderas", name="Recinto Ferial Las Banderas", city="El Puerto de Santa María", aliases=["Las Banderas"],
         events="Puro Latino Fest El Puerto 2026 (23 a 25 de julio).", src="elpuertodesantamaria.es y turismoelpuerto.com (Puro Latino Fest 2026)"),
    dict(id="recinto-ferial-de-torremolinos", name="Recinto Ferial de Torremolinos", city="Torremolinos", aliases=["Feria de Torremolinos"],
         events="Puro Latino / Reggaeton Beach Festival Torremolinos 2026 (17 y 18 de julio).", src="Resultados de búsqueda sobre Puro Latino y RBF 2026 (dodmagazine.es, festivaleate.es)"),
    dict(id="recinto-ferial-de-almeria", name="Recinto Ferial de Almería", city="Almería", aliases=["Feria de Almería"],
         events="Reggaeton Beach Festival 2026 (10 y 11 de julio).", src="festivaleate.es y dodmagazine.es (Reggaeton Beach Festival 2026)"),
    dict(id="ifema-madrid", name="IFEMA Madrid", city="Madrid", aliases=["Feria de Madrid", "IFEMA", "Recinto Ferial Juan Carlos I"],
         events="Recinto ferial de Madrid: grandes fiestas, festivales y conciertos en sus pabellones y exteriores.", src="ifema.es"),
    dict(id="fira-barcelona-gran-via", name="Fira Barcelona Gran Via", city="L'Hospitalet de Llobregat", aliases=["Fira Gran Via", "Gran Via"],
         events="Recinto ferial de Barcelona: grandes fiestas y festivales en sus pabellones.", src="firabarcelona.com"),
    dict(id="recinto-arenal-sound-burriana", name="Recinto de Arenal Sound (Burriana)", city="Burriana", aliases=["Arenal Sound"],
         events="Arenal Sound: de los festivales con más público de España (unas 250.000 personas en 5 días en 2026).", src="ifema.es (mejores festivales de España 2026)"),
    dict(id="recinto-medusa-festival-cullera", name="Recinto de Medusa Festival (Cullera)", city="Cullera", aliases=["Medusa Festival", "Medusa"],
         events="Medusa Festival: unas 200.000 personas en 5 días (2026).", src="ifema.es (mejores festivales de España 2026)"),
    dict(id="recinto-vina-rock-villarrobledo", name="Recinto de Viña Rock (Villarrobledo)", city="Villarrobledo", aliases=["Viña Rock", "Vina Rock"],
         events="Viña Rock: unas 250.000 personas en 4 días (2026).", src="ifema.es (mejores festivales de España 2026)"),
    dict(id="recinto-resurrection-fest-viveiro", name="Recinto de Resurrection Fest (Viveiro)", city="Viveiro", aliases=["Resurrection Fest"],
         events="Resurrection Fest: unas 70.000 personas por día (2026).", src="ifema.es (mejores festivales de España 2026)"),
]
