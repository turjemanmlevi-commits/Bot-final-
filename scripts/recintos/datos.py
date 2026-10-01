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

# Estadios de los clubes habituales de la UEFA Champions League (fuera de España; los
# españoles ya están arriba). Aforo aproximado y nombres habituales de las gradas.
SRC_CHAMPIONS = "Estadios de los clubes habituales de la UEFA Champions League: aforo aproximado y nombres habituales de sus gradas (datos de referencia)"


def ucl(id, name, city, country, clubs, zones, capacity=None, aliases=()):
    return dict(id=id, name=name, city=city, country=country, clubs=list(clubs), zones=zones, capacity=capacity, aliases=list(aliases))


def gen(t=T2, t_end=None, a_main=(), a_opp=(), end1="Fondo Norte", end2="Fondo Sur", a1=(), a2=()):
    """Gradas con nombre orientativo cuando el estadio no tiene nombres propios conocidos."""
    return [z("Tribuna Principal", t, "main", a_main), z("Tribuna Lateral", t, "opp", a_opp), z(end1, t_end or t, "end", a1), z(end2, t_end or t, "end", a2)]


CHAMPIONS_STADIUMS = [
    # Inglaterra
    ucl("anfield", "Anfield", "Liverpool", "Inglaterra", ["Liverpool FC", "Liverpool"],
        [z("Main Stand", T2, "main"), z("Sir Kenny Dalglish Stand", T2, "opp", ["Kenny Dalglish Stand", "Centenary Stand"]),
         z("The Kop", T1, "end", ["Kop", "Spion Kop"]), z("Anfield Road Stand", T2, "end", ["Anfield Road End"])], capacity=61276),
    ucl("etihad-stadium", "Etihad Stadium", "Mánchester", "Inglaterra", ["Manchester City FC", "Manchester City"],
        [z("Colin Bell Stand", T2, "main", ["West Stand"]), z("East Stand", T2, "opp"), z("North Stand", T2, "end"), z("South Stand", T2, "end")],
        aliases=["City of Manchester Stadium"]),
    ucl("emirates-stadium", "Emirates Stadium", "Londres", "Inglaterra", ["Arsenal FC", "Arsenal"],
        [z("West Stand", T2, "main"), z("East Stand", T2, "opp"), z("North Bank", T2, "end"), z("Clock End", T2, "end")], capacity=60704),
    ucl("stamford-bridge", "Stamford Bridge", "Londres", "Inglaterra", ["Chelsea FC", "Chelsea"],
        [z("West Stand", T2, "main"), z("East Stand", T2, "opp"), z("Matthew Harding Stand", T2, "end"), z("Shed End", T2, "end", ["The Shed"])], capacity=40343),
    ucl("old-trafford", "Old Trafford", "Mánchester", "Inglaterra", ["Manchester United FC", "Manchester United"],
        [z("Sir Bobby Charlton Stand", T2, "main", ["South Stand"]), z("Sir Alex Ferguson Stand", T3, "opp", ["North Stand"]),
         z("Stretford End", T2, "end"), z("East Stand", T2, "end")], capacity=74310),
    ucl("tottenham-hotspur-stadium", "Tottenham Hotspur Stadium", "Londres", "Inglaterra", ["Tottenham Hotspur FC", "Tottenham Hotspur"],
        [z("West Stand", T2, "main"), z("East Stand", T2, "opp"), z("South Stand", T1, "end"), z("North Stand", T2, "end")], capacity=62850),
    ucl("st-james-park", "St James' Park", "Newcastle", "Inglaterra", ["Newcastle United FC", "Newcastle United"],
        [z("Milburn Stand", T2, "main"), z("East Stand", T1, "opp"), z("Gallowgate End", T2, "end"), z("Leazes End", T2, "end", ["Sir John Hall Stand"])], capacity=52258,
        aliases=["St. James' Park", "St James Park"]),
    ucl("villa-park", "Villa Park", "Birmingham", "Inglaterra", ["Aston Villa FC", "Aston Villa"],
        [z("Trinity Road Stand", T2, "main"), z("Doug Ellis Stand", T2, "opp"), z("Holte End", T2, "end"), z("North Stand", T2, "end")]),
    # Alemania
    ucl("allianz-arena", "Allianz Arena", "Múnich", "Alemania", ["FC Bayern München", "Bayern de Múnich", "Bayern Munich"],
        gen(T3, end1="Nordkurve", end2="Südkurve", a1=("Curva Norte",), a2=("Curva Sur",)), capacity=75024, aliases=["Fußball Arena München"]),
    ucl("signal-iduna-park", "Signal Iduna Park", "Dortmund", "Alemania", ["Borussia Dortmund", "Dortmund"],
        [z("Westtribüne", T2, "main", ["Tribuna Oeste"]), z("Osttribüne", T2, "opp", ["Tribuna Este"]),
         z("Südtribüne", T1, "end", ["Gelbe Wand", "Muro Amarillo", "Tribuna Sur"]), z("Nordtribüne", T2, "end", ["Tribuna Norte"])], capacity=81365,
        aliases=["Westfalenstadion", "BVB Stadion Dortmund"]),
    ucl("bayarena", "BayArena", "Leverkusen", "Alemania", ["Bayer 04 Leverkusen", "Bayer Leverkusen"], gen(), capacity=30210),
    ucl("red-bull-arena-leipzig", "Red Bull Arena (Leipzig)", "Leipzig", "Alemania", ["RB Leipzig"], gen(), capacity=47069, aliases=["Red Bull Arena Leipzig"]),
    ucl("mhparena", "MHPArena", "Stuttgart", "Alemania", ["VfB Stuttgart"],
        gen(end1="Cannstatter Kurve", end2="Untertürkheimer Kurve"), aliases=["Mercedes-Benz Arena", "Neckarstadion"]),
    ucl("deutsche-bank-park", "Deutsche Bank Park", "Fráncfort", "Alemania", ["Eintracht Frankfurt"], gen(), aliases=["Waldstadion", "Frankfurt Stadium"]),
    # Italia
    ucl("stadio-san-siro", "Stadio San Siro (Giuseppe Meazza)", "Milán", "Italia", ["FC Internazionale Milano", "Inter de Milán", "Inter", "AC Milan", "Milan"],
        gen(T3, end1="Curva Nord", end2="Curva Sud"), capacity=75817, aliases=["San Siro", "Stadio Giuseppe Meazza", "Giuseppe Meazza"]),
    ucl("allianz-stadium-turin", "Allianz Stadium (Turín)", "Turín", "Italia", ["Juventus FC", "Juventus"],
        [z("Tribuna Ovest", T2, "main"), z("Tribuna Est", T2, "opp"), z("Curva Nord", T2, "end"), z("Curva Sud", T2, "end", ["Curva Scirea"])], capacity=41507,
        aliases=["Juventus Stadium", "Allianz Stadium Torino"]),
    ucl("stadio-diego-armando-maradona", "Stadio Diego Armando Maradona", "Nápoles", "Italia", ["SSC Napoli", "Napoli", "Nápoles"],
        [z("Tribuna Posillipo", T2, "main"), z("Tribuna Nisida", T2, "opp"), z("Curva A", T2, "end"), z("Curva B", T2, "end")], capacity=54726,
        aliases=["Stadio San Paolo", "Maradona"]),
    ucl("stadio-olimpico-roma", "Stadio Olimpico (Roma)", "Roma", "Italia", ["AS Roma", "Roma", "SS Lazio", "Lazio"],
        [z("Tribuna Monte Mario", T1, "main"), z("Tribuna Tevere", T1, "opp"), z("Curva Nord", T1, "end"), z("Curva Sud", T1, "end")], capacity=70634,
        aliases=["Olimpico di Roma", "Stadio Olimpico di Roma"]),
    ucl("gewiss-stadium", "Gewiss Stadium", "Bérgamo", "Italia", ["Atalanta BC", "Atalanta"], gen(T1, end1="Curva Nord", end2="Curva Sud"),
        aliases=["Stadio Atleti Azzurri d'Italia"]),
    # Francia
    ucl("parc-des-princes", "Parc des Princes", "París", "Francia", ["Paris Saint-Germain FC", "Paris Saint-Germain", "PSG"],
        [z("Tribune Présidentielle", T2, "main"), z("Tribune Paris", T2, "opp"), z("Tribune Auteuil", T2, "end", ["Virage Auteuil"]),
         z("Tribune Boulogne", T2, "end", ["Virage Boulogne"])], capacity=47929, aliases=["Parque de los Príncipes"]),
    ucl("stade-velodrome", "Stade Vélodrome", "Marsella", "Francia", ["Olympique de Marseille", "Marseille", "Olympique de Marsella"],
        [z("Tribune Jean-Bouin", T2, "main"), z("Tribune Ganay", T2, "opp"), z("Virage Nord", T2, "end", ["Virage Depé"]),
         z("Virage Sud", T2, "end", ["Virage Chevalier Roze"])], capacity=67394, aliases=["Orange Vélodrome", "Velodrome"]),
    ucl("stade-louis-ii", "Stade Louis II", "Mónaco", "Mónaco", ["AS Monaco FC", "AS Monaco", "Mónaco"], gen(T1), capacity=18523),
    ucl("groupama-stadium", "Groupama Stadium", "Lyon", "Francia", ["Olympique Lyonnais", "Lyon", "Olympique de Lyon"],
        gen(end1="Virage Nord", end2="Virage Sud"), capacity=59186, aliases=["Parc Olympique Lyonnais", "Stade des Lumières"]),
    ucl("stade-pierre-mauroy", "Stade Pierre-Mauroy", "Lille", "Francia", ["Lille OSC", "LOSC Lille", "Lille"], gen(end1="Virage Nord", end2="Virage Sud"),
        capacity=50186, aliases=["Decathlon Arena", "Grand Stade Lille Métropole"]),
    ucl("stade-bollaert-delelis", "Stade Bollaert-Delelis", "Lens", "Francia", ["Racing Club de Lens", "RC Lens", "Lens"], gen(), aliases=["Bollaert"]),
    # Portugal
    ucl("estadio-da-luz", "Estádio da Luz", "Lisboa", "Portugal", ["Sport Lisboa e Benfica", "SL Benfica", "Benfica"],
        gen(T3, end1="Topo Norte", end2="Topo Sul"), aliases=["Estadio da Luz", "Estadio de la Luz"]),
    ucl("estadio-do-dragao", "Estádio do Dragão", "Oporto", "Portugal", ["FC Porto", "Oporto", "Porto"],
        [z("Bancada Poente", T2, "main"), z("Bancada Nascente", T2, "opp"), z("Topo Norte", T2, "end"), z("Topo Sul", T2, "end")], capacity=50033,
        aliases=["Estadio do Dragao", "Estadio del Dragón"]),
    ucl("estadio-jose-alvalade", "Estádio José Alvalade", "Lisboa", "Portugal", ["Sporting Clube de Portugal", "Sporting CP", "Sporting de Portugal"],
        gen(end1="Topo Norte", end2="Topo Sul"), capacity=50095, aliases=["Estadio José Alvalade", "Alvalade"]),
    # Países Bajos, Bélgica y Escocia
    ucl("johan-cruijff-arena", "Johan Cruijff ArenA", "Ámsterdam", "Países Bajos", ["AFC Ajax", "Ajax"], gen(), capacity=55865,
        aliases=["Johan Cruyff Arena", "Amsterdam ArenA"]),
    ucl("philips-stadion", "Philips Stadion", "Eindhoven", "Países Bajos", ["PSV", "PSV Eindhoven"], gen(), capacity=35000),
    ucl("de-kuip", "De Kuip (Stadion Feijenoord)", "Róterdam", "Países Bajos", ["Feyenoord Rotterdam", "Feyenoord"], gen(), aliases=["De Kuip", "Stadion Feijenoord"]),
    ucl("jan-breydel", "Estadio Jan Breydel", "Brujas", "Bélgica", ["Club Brugge KV", "Club Brujas", "Club Brugge"], gen(T1), capacity=29062,
        aliases=["Jan Breydelstadion", "Jan Breydel"]),
    ucl("celtic-park", "Celtic Park", "Glasgow", "Escocia", ["Celtic FC", "Celtic"],
        [z("Main Stand", T2, "main"), z("North Stand", T2, "opp"), z("Lisbon Lions Stand", T2, "end"), z("Jock Stein Stand", T2, "end")], capacity=60411),
    ucl("ibrox-stadium", "Ibrox Stadium", "Glasgow", "Escocia", ["Rangers FC", "Rangers"],
        [z("Bill Struth Main Stand", T3, "main", ["Main Stand"]), z("Govan Stand", T2, "opp"), z("Broomloan Road Stand", T2, "end"),
         z("Sandy Jardine Stand", T2, "end", ["Copland Road Stand"])], capacity=50817, aliases=["Ibrox"]),
    # Turquía, Grecia y centro de Europa
    ucl("rams-park", "RAMS Park", "Estambul", "Turquía", ["Galatasaray SK", "Galatasaray"], gen(), capacity=52280, aliases=["Türk Telekom Stadium", "Ali Sami Yen"]),
    ucl("sukru-saracoglu", "Estadio Şükrü Saracoğlu", "Estambul", "Turquía", ["Fenerbahçe SK", "Fenerbahçe"], gen(),
        aliases=["Şükrü Saracoğlu", "Sukru Saracoglu", "Chobani Stadyumu"]),
    ucl("estadio-karaiskakis", "Estadio Georgios Karaiskakis", "El Pireo", "Grecia", ["Olympiacos FC", "Olympiacos"], gen(T1), capacity=32115,
        aliases=["Karaiskakis", "Georgios Karaiskakis Stadium"]),
    ucl("red-bull-arena-salzburgo", "Red Bull Arena (Salzburgo)", "Salzburgo", "Austria", ["FC Red Bull Salzburg", "Red Bull Salzburgo", "Salzburg"], gen(T1),
        aliases=["Red Bull Arena Salzburg", "Stadion Salzburg"]),
    ucl("stadion-wankdorf", "Stadion Wankdorf", "Berna", "Suiza", ["BSC Young Boys", "Young Boys"], gen(T1), aliases=["Wankdorf"]),
    ucl("parken", "Parken", "Copenhague", "Dinamarca", ["FC København", "FC Copenhague", "Copenhague"], gen(), capacity=38065, aliases=["Parken Stadion"]),
    ucl("fortuna-arena-praga", "Fortuna Arena (Praga)", "Praga", "Chequia", ["SK Slavia Praha", "Slavia de Praga"], gen(T1), capacity=19370,
        aliases=["Eden Arena", "Sinobo Stadium", "Stadion Eden"]),
    ucl("stadion-maksimir", "Stadion Maksimir", "Zagreb", "Croacia", ["GNK Dinamo Zagreb", "Dinamo Zagreb"], gen(T1), aliases=["Maksimir"]),
    ucl("estadio-rajko-mitic", "Estadio Rajko Mitić", "Belgrado", "Serbia", ["FK Crvena Zvezda", "Estrella Roja", "Crvena Zvezda"], gen(), capacity=51755,
        aliases=["Rajko Mitić", "Marakana", "Stadion Crvena Zvezda"]),
    ucl("aspmyra", "Aspmyra Stadion", "Bodø", "Noruega", ["FK Bodø/Glimt", "Bodø/Glimt"], gen(T1), capacity=8270, aliases=["Aspmyra"]),
    ucl("estadio-tofiq-bahramov", "Estadio Tofiq Bahramov", "Bakú", "Azerbaiyán", ["Qarabağ FK", "Qarabag"], gen(T1),
        aliases=["Tofiq Bahramov Republican Stadium", "Tofiq Bahramov"]),
    ucl("estadio-central-almaty", "Estadio Central de Almaty", "Almaty", "Kazajistán", ["FC Kairat", "Kairat Almaty"], gen(T1), aliases=["Almaty Central Stadium"]),
]
