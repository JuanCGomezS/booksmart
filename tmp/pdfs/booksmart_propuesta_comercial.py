from pathlib import Path

from PIL import Image
from reportlab.lib.colors import Color, HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[2]
TMP = ROOT / "tmp/pdfs"
ASSETS = TMP / "assets"
OUT = ROOT / "output/pdf/booksmart-propuesta-comercial.pdf"
W, H = 595.28, 841.89

NAVY = HexColor("#071B35")
NAVY_2 = HexColor("#0D2C57")
BLUE = HexColor("#1677FF")
CYAN = HexColor("#38C4FF")
PINK = HexColor("#FF4D8D")
YELLOW = HexColor("#FFCB45")
MINT = HexColor("#56E2B3")
WHITE = HexColor("#FFFFFF")
PAPER = HexColor("#F6F8FC")
INK = HexColor("#0B1F3A")
MUTED = HexColor("#5A6E89")
LINE = HexColor("#D5E0EF")

pdfmetrics.registerFont(
    TTFont("Ubuntu", "/usr/share/fonts/truetype/ubuntu/Ubuntu[wdth,wght].ttf")
)
pdfmetrics.registerFont(
    TTFont("UbuntuBold", "/usr/share/fonts/truetype/ubuntu/Ubuntu[wdth,wght].ttf")
)


def font(c, name="Ubuntu", size: float = 10):
    c.setFont(name, size)


def lines(text, width: float, name="Ubuntu", size: float = 10):
    out, current = [], ""
    for word in text.split():
        attempt = f"{current} {word}".strip()
        if not current or stringWidth(attempt, name, size) <= width:
            current = attempt
        else:
            out.append(current)
            current = word
    return out + ([current] if current else [])


def para(
    c,
    text,
    x,
    y,
    width: float,
    size: float = 10,
    color=INK,
    leading=None,
    name="Ubuntu",
):
    leading = leading or size * 1.4
    c.setFillColor(color)
    font(c, name, size)
    for line in lines(text, width, name, size):
        c.drawString(x, y, line)
        y -= leading
    return y


def box(c, x, y, w, h, fill, stroke=None, radius=12, alpha=1):
    c.saveState()
    c.setFillColor(fill)
    c.setFillAlpha(alpha)
    c.setStrokeColor(stroke or fill)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1 if stroke else 0)
    c.restoreState()


def dot(c, x, y, r, color):
    c.setFillColor(color)
    c.circle(x, y, r, stroke=0, fill=1)


def draw_lines(c, x, y, values, color=CYAN, width=122):
    c.setStrokeColor(color)
    c.setLineWidth(5)
    for i, value in enumerate(values):
        c.line(x, y - i * 23, x + value * width, y - i * 23)


def footer(c, page, dark=False):
    color = HexColor("#ABC0DC") if dark else MUTED
    c.setStrokeColor(color)
    c.setLineWidth(0.55)
    c.line(42, 34, W - 42, 34)
    c.setFillColor(color)
    font(c, "UbuntuBold", 7.5)
    c.drawString(42, 19, "BOOKSMART  /  PROPUESTA COMERCIAL")
    c.drawRightString(W - 42, 19, f"{page:02d}")


def top(c, tag, page, dark=False):
    color = HexColor("#BFDAFF") if dark else MUTED
    c.setFillColor(color)
    font(c, "UbuntuBold", 8)
    c.drawString(44, 798, tag.upper())
    dot(c, 32, 800, 4, PINK if page % 2 else YELLOW)
    footer(c, page, dark)


def hero_title(c, text, x, y, width, size=40, color=WHITE):
    c.setFillColor(color)
    font(c, "UbuntuBold", size)
    for line in lines(text, width, "UbuntuBold", size):
        c.drawString(x, y, line)
        y -= size * 0.94
    return y


def cover_crop():
    ASSETS.mkdir(parents=True, exist_ok=True)
    target = ASSETS / "booksmart-cover-editorial.png"
    src = ROOT / "public/images/hero-dashboard.png"
    im = Image.open(src).convert("RGB")
    # Portrait crop avoids the legacy labels embedded in the supplied image.
    im.crop((700, 0, 1124, 1024)).save(target, quality=95)
    return target


def page_cover(c):
    img = cover_crop()
    c.setFillColor(NAVY)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    c.drawImage(
        str(img),
        246,
        0,
        width=349,
        height=842,
        preserveAspectRatio=True,
        anchor="c",
        mask="auto",
    )
    c.setFillColor(Color(0.02, 0.10, 0.22, alpha=0.8))
    c.rect(0, 0, 380, H, stroke=0, fill=1)
    c.setFillColor(Color(0.02, 0.10, 0.22, alpha=0.28))
    c.rect(250, 0, 345, H, stroke=0, fill=1)
    for x, y, r, color in [
        (40, 725, 16, PINK),
        (511, 736, 9, YELLOW),
        (514, 214, 18, CYAN),
        (71, 187, 5, MINT),
    ]:
        dot(c, x, y, r, color)
    c.setFillColor(WHITE)
    font(c, "UbuntuBold", 23)
    c.drawString(48, 770, "BookSmart")
    c.setFillColor(CYAN)
    font(c, "UbuntuBold", 8)
    c.drawString(48, 744, "AGENDA · EQUIPO · VITRINA · ASISTENTE")
    y = hero_title(c, "QUE TU NEGOCIO NO DEPENDA DEL CHAT.", 48, 665, 310, 42)
    para(
        c,
        "Una plataforma para administrar la operación de negocios que atienden por cita y dar a los clientes un recorrido claro para reservar.",
        48,
        y - 22,
        272,
        12,
        HexColor("#D1E0F3"),
        17,
    )
    box(c, 48, 247, 205, 52, PINK, None, 8)
    c.setFillColor(NAVY)
    font(c, "UbuntuBold", 10)
    c.drawCentredString(150, 267, "PRUEBA EL PRIMER MES")
    c.setFillColor(WHITE)
    font(c, "Ubuntu", 8)
    c.drawString(48, 94, "Propuesta comercial · Colombia")
    c.drawString(48, 77, "Planes desde $50.000 / mes")
    c.setFillColor(WHITE)
    font(c, "Ubuntu", 6.6)
    c.drawRightString(W - 23, 20, "Imagen editorial suministrada por el proyecto")


def page_problem(c):
    c.setFillColor(PAPER)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    top(c, "El punto de partida", 2)
    hero_title(c, "UN NEGOCIO POR CITA MUEVE MUCHAS PIEZAS.", 44, 730, 495, 31, INK)
    para(
        c,
        "Cuando cada pieza vive en un lugar distinto, el equipo trabaja más para encontrar contexto que para atender.",
        44,
        645,
        440,
        11,
        MUTED,
        16,
    )
    labels = [
        ("WhatsApp", PINK),
        ("Agenda", BLUE),
        ("Equipo", MINT),
        ("Oferta", YELLOW),
    ]
    positions = [(72, 476), (254, 522), (78, 310), (320, 330)]
    for (label, color), (x, y) in zip(labels, positions, strict=True):
        box(c, x, y, 160, 76, WHITE, LINE, 14)
        dot(c, x + 24, y + 38, 13, color)
        c.setFillColor(INK)
        font(c, "UbuntuBold", 16)
        c.drawString(x + 48, y + 45, label)
        c.setFillColor(MUTED)
        font(c, "Ubuntu", 8.4)
        c.drawString(x + 48, y + 29, "Información que debe coincidir")
    c.setStrokeColor(BLUE)
    c.setLineWidth(2)
    for a, b in [
        ((232, 514), (254, 560)),
        ((232, 356), (320, 368)),
        ((158, 476), (158, 386)),
    ]:
        c.line(*a, *b)
    box(c, 211, 404, 167, 94, NAVY, None, 48)
    c.setFillColor(WHITE)
    font(c, "UbuntuBold", 17)
    c.drawCentredString(294, 453, "LA OPERACIÓN")
    c.setFillColor(CYAN)
    font(c, "UbuntuBold", 8)
    c.drawCentredString(294, 433, "NECESITA UN CENTRO")
    box(c, 44, 150, 507, 94, NAVY_2, None, 18)
    c.setFillColor(WHITE)
    font(c, "UbuntuBold", 17)
    c.drawString(70, 203, "Una operación. Un solo centro.")
    para(
        c,
        "No promete reemplazar el oficio: organiza la información para que el negocio pueda atender con contexto.",
        70,
        181,
        420,
        9.5,
        HexColor("#C9DBF5"),
        13,
    )
    footer(c, 2)


def page_flow(c):
    c.setFillColor(NAVY)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    top(c, "El recorrido BookSmart", 3, True)
    hero_title(c, "DE LA PÁGINA A LA CITA. SIN PERDER EL HILO.", 44, 730, 500, 31)
    steps = [
        (
            "01",
            "Vitrina pública",
            "Servicios, galería, productos, ubicación y datos del negocio.",
        ),
        (
            "02",
            "Solicitud",
            "Servicio, fecha, profesional y horario según disponibilidad.",
        ),
        (
            "03",
            "Operación",
            "Administración y personal consultan los controles de su trabajo.",
        ),
    ]
    y = 480
    for i, (n, h, body) in enumerate(steps):
        x = 44 + i * 177
        box(c, x, y, 154, 180, WHITE, None, 16)
        c.setFillColor(BLUE if i != 1 else PINK)
        font(c, "UbuntuBold", 11)
        c.drawString(x + 18, y + 148, n)
        c.setFillColor(INK)
        font(c, "UbuntuBold", 16)
        c.drawString(x + 18, y + 116, h)
        para(c, body, x + 18, y + 88, 115, 9, MUTED, 13)
        if i < 2:
            c.setStrokeColor(CYAN)
            c.setLineWidth(2)
            c.line(x + 154, y + 90, x + 174, y + 90)
            dot(c, x + 174, y + 90, 4, CYAN)
    box(c, 44, 262, 507, 170, HexColor("#102B52"), None, 20)
    c.setFillColor(WHITE)
    font(c, "UbuntuBold", 18)
    c.drawString(70, 386, "Elige lo relevante. El resto se conecta.")
    for i, (label, color, bars) in enumerate(
        [
            ("AGENDA", CYAN, [0.78, 0.54, 0.91]),
            ("EQUIPO", MINT, [0.60, 0.88, 0.46]),
            ("OFERTA", YELLOW, [0.72, 0.38, 0.93]),
        ]
    ):
        x = 70 + i * 152
        c.setFillColor(color)
        font(c, "UbuntuBold", 8)
        c.drawString(x, 350, label)
        draw_lines(c, x, 326, bars, color, 100)
    para(
        c,
        "Cada paso se ilustra con datos de ejemplo. Las capacidades dependen de la configuración y despliegue de cada negocio.",
        44,
        205,
        485,
        8.5,
        HexColor("#B8CCE9"),
        12,
    )
    footer(c, 3, True)


def page_booking(c):
    c.setFillColor(WHITE)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    top(c, "Gancho 01 · Agendamiento", 4)
    hero_title(
        c,
        "RESERVAR DEBERÍA SER TAN CLARO COMO ELEGIR UN SERVICIO.",
        44,
        730,
        500,
        31,
        INK,
    )
    box(c, 42, 240, 270, 385, NAVY, None, 26)
    c.setFillColor(WHITE)
    font(c, "UbuntuBold", 10)
    c.drawString(68, 590, "EJEMPLO DE RECORRIDO PÚBLICO")
    c.setFillColor(CYAN)
    font(c, "UbuntuBold", 23)
    c.drawString(68, 550, "Reserva tu cita")
    for y, name, value in [
        (488, "Servicio", "Corte + barba"),
        (428, "Fecha", "Martes 18"),
        (368, "Profesional", "Cualquier disponible"),
        (308, "Hora", "10:30 a. m."),
    ]:
        box(c, 68, y, 217, 44, HexColor("#133963"), None, 8)
        c.setFillColor(HexColor("#B9D4F1"))
        font(c, "UbuntuBold", 7)
        c.drawString(82, y + 28, name.upper())
        c.setFillColor(WHITE)
        font(c, "UbuntuBold", 10)
        c.drawRightString(268, y + 14, value)
    box(c, 68, 258, 217, 34, PINK, None, 7)
    c.setFillColor(NAVY)
    font(c, "UbuntuBold", 8.5)
    c.drawCentredString(176, 270, "SOLICITAR CITA")
    c.setFillColor(INK)
    font(c, "UbuntuBold", 24)
    c.drawString(350, 566, "Agenda con reglas")
    para(
        c,
        "La solicitud considera servicios, profesionales, horarios, descansos, cierres y disponibilidad configurados para el negocio.",
        350,
        531,
        176,
        11,
        MUTED,
        16,
    )
    for y, label, color in [
        (424, "Servicio primero", BLUE),
        (360, "Profesional compatible", MINT),
        (296, "Horario disponible", PINK),
    ]:
        dot(c, 362, y, 10, color)
        c.setFillColor(INK)
        font(c, "UbuntuBold", 11)
        c.drawString(382, y - 4, label)
    box(c, 350, 170, 176, 82, HexColor("#E8F1FF"), None, 12)
    c.setFillColor(INK)
    font(c, "UbuntuBold", 10)
    c.drawString(368, 222, "CADA ELECCIÓN ACLARA")
    c.drawString(368, 205, "LA SIGUIENTE.")
    para(
        c,
        "Una solicitud estructurada llega con contexto.",
        368,
        187,
        140,
        8.5,
        MUTED,
        12,
    )
    footer(c, 4)


def page_ai(c):
    c.setFillColor(HexColor("#EAF6FF"))
    c.rect(0, 0, W, H, stroke=0, fill=1)
    top(c, "Gancho 02 · Asistente con IA", 5)
    hero_title(
        c, "TU INFORMACIÓN PÚBLICA, LISTA PARA RESPONDER.", 44, 730, 500, 31, INK
    )
    box(c, 44, 257, 507, 370, NAVY, None, 24)
    for x, y, r, color in [
        (87, 572, 18, PINK),
        (494, 566, 32, CYAN),
        (463, 319, 14, YELLOW),
        (109, 306, 8, MINT),
    ]:
        dot(c, x, y, r, color)
    box(c, 78, 452, 250, 115, WHITE, None, 16)
    c.setFillColor(INK)
    font(c, "UbuntuBold", 9)
    c.drawString(98, 540, "CLIENTE")
    c.setFillColor(NAVY)
    font(c, "UbuntuBold", 15)
    c.drawString(98, 511, "¿Cuál servicio me conviene?")
    box(c, 218, 320, 280, 104, HexColor("#1A4675"), None, 16)
    c.setFillColor(CYAN)
    font(c, "UbuntuBold", 9)
    c.drawString(240, 397, "ASISTENTE PÚBLICO")
    para(
        c,
        "Responde con el contexto publicado por el negocio y sus datos públicos permitidos.",
        240,
        373,
        220,
        10,
        WHITE,
        14,
        "UbuntuBold",
    )
    c.setFillColor(INK)
    font(c, "UbuntuBold", 21)
    c.drawString(44, 211, "IA que parte de información que tú publicas.")
    para(
        c,
        "El administrador revisa y publica el contexto. El asistente también puede usar servicios, horarios, productos y profesionales públicos. No se deben incluir datos de clientes, información clínica ni instrucciones internas.",
        44,
        181,
        480,
        10.5,
        MUTED,
        15,
    )
    footer(c, 5)


def page_price(c):
    c.setFillColor(NAVY)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    top(c, "Planes", 6, True)
    hero_title(c, "EMPIEZA SIN PAGAR EL PRIMER MES.", 44, 730, 500, 32)
    para(
        c,
        "Luego elige el ritmo que más le conviene a tu negocio.",
        44,
        660,
        380,
        11,
        HexColor("#C6D9F3"),
        16,
    )
    plans = [
        ("MENSUAL", "$50.000", "por mes", BLUE),
        ("TRIMESTRAL", "$140.000", "por 3 meses", PINK),
        ("ANUAL", "$550.000", "por 1 año", YELLOW),
    ]
    for i, (name, price, term, color) in enumerate(plans):
        x = 44 + i * 170
        box(c, x, 343, 151, 242, WHITE, None, 17)
        c.setFillColor(color)
        c.rect(x, 532, 151, 53, stroke=0, fill=1)
        c.setFillColor(NAVY)
        font(c, "UbuntuBold", 10)
        c.drawCentredString(x + 75, 552, name)
        c.setFillColor(INK)
        font(c, "UbuntuBold", 24)
        c.drawCentredString(x + 75, 485, price)
        c.setFillColor(MUTED)
        font(c, "UbuntuBold", 9)
        c.drawCentredString(x + 75, 461, term)
        c.setStrokeColor(LINE)
        c.line(x + 22, 433, x + 129, 433)
        para(
            c,
            "Acceso a la plataforma y sus capacidades según configuración.",
            x + 20,
            408,
            112,
            8.5,
            MUTED,
            12,
        )
    box(c, 44, 218, 507, 74, PINK, None, 18)
    c.setFillColor(NAVY)
    font(c, "UbuntuBold", 17)
    c.drawString(70, 258, "1 MES GRATIS PARA CONOCER EL RECORRIDO.")
    para(
        c,
        "Consulta condiciones comerciales y el alcance aplicable antes de iniciar la prueba.",
        70,
        237,
        400,
        9.5,
        NAVY,
        13,
    )
    footer(c, 6, True)


def page_support(c):
    c.setFillColor(PAPER)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    top(c, "Acompañamiento y crecimiento", 7)
    hero_title(
        c, "NO TE ENTREGAMOS UNA HERRAMIENTA Y DESAPARECEMOS.", 44, 730, 500, 31, INK
    )
    box(c, 44, 472, 507, 123, WHITE, LINE, 20)
    c.setFillColor(INK)
    font(c, "UbuntuBold", 18)
    c.drawString(72, 555, "Soporte por WhatsApp o correo")
    para(
        c,
        "Acompañamiento y asesoramiento para resolver preguntas sobre el uso de la plataforma.",
        72,
        529,
        340,
        10.5,
        MUTED,
        15,
    )
    box(c, 44, 291, 241, 132, BLUE, None, 18)
    c.setFillColor(WHITE)
    font(c, "UbuntuBold", 17)
    c.drawString(68, 378, "Contenido que se ve bien")
    para(
        c,
        "Ayuda con edición de imágenes y contenido como servicio adicional.",
        68,
        351,
        182,
        9.5,
        WHITE,
        14,
    )
    box(c, 310, 291, 241, 132, NAVY, None, 18)
    c.setFillColor(MINT)
    font(c, "UbuntuBold", 17)
    c.drawString(334, 378, "Más de una sede")
    para(
        c,
        "Extensión para operaciones de más de 10 tiendas. Consulta alcance y condiciones.",
        334,
        351,
        180,
        9.5,
        HexColor("#D5E4F5"),
        14,
    )
    c.setFillColor(INK)
    font(c, "UbuntuBold", 20)
    c.drawString(44, 220, "Conecta la conversación con tu presencia digital.")
    for i, (name, color) in enumerate(
        [
            ("Instagram", PINK),
            ("Facebook", BLUE),
            ("Google", YELLOW),
            ("WhatsApp", MINT),
        ]
    ):
        x = 44 + i * 126
        dot(c, x + 17, 168, 14, color)
        c.setFillColor(INK)
        font(c, "UbuntuBold", 10)
        c.drawString(x + 39, 164, name)
    para(
        c,
        "Disponibilidad e integración deben confirmarse según el plan, la configuración y los canales del negocio.",
        44,
        121,
        470,
        8.5,
        MUTED,
        12,
    )
    footer(c, 7)


def page_offerings(c):
    c.setFillColor(NAVY)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    top(c, "Todo lo que ofrece BookSmart", 8, True)
    hero_title(c, "UNA PLATAFORMA. SIETE FORMAS DE MOVER EL NEGOCIO.", 44, 730, 500, 30)
    para(
        c,
        "Capacidades para presentar, coordinar, atender y revisar una operación por cita.",
        44,
        645,
        440,
        10.5,
        HexColor("#C8DBF5"),
        15,
    )
    offerings = [
        (
            "Agendamiento",
            "Solicitud por servicio, fecha, profesional y horario disponible.",
            BLUE,
        ),
        (
            "Galería",
            "Muestra trabajos, instalaciones o resultados en el sitio público.",
            PINK,
        ),
        (
            "Productos",
            "Presenta productos, precio e imagen desde la operación.",
            YELLOW,
        ),
        (
            "Panel de control",
            "Agenda, contenidos y operación reunidos en una misma mesa.",
            MINT,
        ),
        (
            "Personalización",
            "Adapta la identidad y el estilo de la presencia pública.",
            CYAN,
        ),
        (
            "Estadísticas",
            "Consulta citas, ingresos, ticket, finalización y no asistencia por periodo.",
            PINK,
        ),
        (
            "Asistente con IA",
            "Responde desde el contexto y los datos públicos publicados por el negocio.",
            BLUE,
        ),
    ]
    positions = [
        (44, 496),
        (44, 404),
        (44, 312),
        (44, 220),
        (309, 496),
        (309, 404),
        (309, 286),
    ]
    for (heading, detail, color), (x, y) in zip(offerings, positions, strict=True):
        h = 72 if heading != "Asistente con IA" else 98
        box(c, x, y, 242, h, HexColor("#102B52"), None, 13)
        dot(c, x + 20, y + h - 20, 7, color)
        c.setFillColor(WHITE)
        font(c, "UbuntuBold", 12)
        c.drawString(x + 38, y + h - 25, heading)
        para(c, detail, x + 20, y + h - 47, 200, 8.6, HexColor("#D1E2F8"), 11.5)
    c.setStrokeColor(HexColor("#294E7C"))
    c.setLineWidth(1)
    c.line(285, 255, 309, 330)
    c.line(285, 395, 309, 440)
    box(c, 44, 132, 507, 58, HexColor("#123867"), None, 14)
    c.setFillColor(CYAN)
    font(c, "UbuntuBold", 10)
    c.drawString(68, 166, "CAPACIDADES CONECTADAS")
    para(
        c,
        "Lo que ve el cliente, lo que configura el negocio y lo que consulta el equipo parte de la misma operación.",
        68,
        148,
        410,
        8.7,
        HexColor("#D4E4FA"),
        12,
    )
    footer(c, 8, True)


def page_proof(c):
    c.setFillColor(WHITE)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    top(c, "Hecho para negocios por cita", 9)
    hero_title(
        c,
        "TU NEGOCIO TIENE RITMO. TU PLATAFORMA TAMBIÉN DEBERÍA TENERLO.",
        44,
        730,
        505,
        31,
        INK,
    )
    c.setFillColor(MUTED)
    font(c, "Ubuntu", 11)
    c.drawString(
        44,
        644,
        "Barberías · Salones · Estudios de uñas · Clínicas dentales · Otros servicios por cita",
    )
    box(c, 44, 430, 507, 155, NAVY, None, 24)
    c.setFillColor(WHITE)
    font(c, "UbuntuBold", 22)
    c.drawString(72, 537, "Misma plataforma. Distintas operaciones.")
    para(
        c,
        "Administración, personal y clientes pueden recorrer la información relevante para su trabajo. La página pública se convierte en una puerta clara hacia la solicitud.",
        72,
        505,
        400,
        10.5,
        HexColor("#D7E5F5"),
        15,
    )
    for i, (title, body, color) in enumerate(
        [
            ("VISIBLE", "Servicios, productos, galería y ubicación.", BLUE),
            ("ORDENADO", "Agenda y accesos por rol.", PINK),
            ("CONTEXTUAL", "Asistente con información pública.", MINT),
        ]
    ):
        x = 44 + i * 171
        box(c, x, 254, 150, 112, HexColor("#F0F5FC"), None, 14)
        dot(c, x + 22, 335, 9, color)
        c.setFillColor(INK)
        font(c, "UbuntuBold", 12)
        c.drawString(x + 40, 330, title)
        para(c, body, x + 20, 304, 112, 8.4, MUTED, 12)
    box(c, 44, 156, 507, 60, HexColor("#FFF3D4"), None, 14)
    c.setFillColor(INK)
    font(c, "UbuntuBold", 11)
    c.drawString(66, 187, "Impacto: mídelo con tu propia operación.")
    para(
        c,
        "No se muestran porcentajes de ventas, reservas o asistencia sin medición propia y verificable.",
        66,
        168,
        420,
        8.7,
        MUTED,
        12,
    )
    footer(c, 9)


def page_cta(c):
    c.setFillColor(NAVY)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    top(c, "Siguiente paso", 10, True)
    for x, y, r, color in [
        (61, 660, 22, PINK),
        (502, 700, 16, YELLOW),
        (482, 237, 24, CYAN),
        (88, 194, 9, MINT),
    ]:
        dot(c, x, y, r, color)
    hero_title(c, "PON TU OPERACIÓN EN MOVIMIENTO.", 44, 725, 480, 38)
    para(
        c,
        "Conversemos sobre la agenda, el equipo y la experiencia que quieres construir para tus clientes.",
        44,
        590,
        390,
        12,
        HexColor("#C8DBF5"),
        17,
    )
    box(c, 44, 354, 507, 150, WHITE, None, 24)
    c.setFillColor(INK)
    font(c, "UbuntuBold", 18)
    c.drawString(74, 456, "Agenda una demostración")
    para(
        c,
        "Revisemos tus servicios, profesionales, horarios y prioridades. Te mostramos lo que realmente aplica a tu negocio.",
        74,
        428,
        325,
        10,
        MUTED,
        14,
    )
    box(c, 74, 376, 211, 34, PINK, None, 8)
    c.setFillColor(NAVY)
    font(c, "UbuntuBold", 9)
    c.drawCentredString(179, 389, "HABLEMOS POR WHATSAPP")
    c.setFillColor(WHITE)
    font(c, "UbuntuBold", 17)
    c.drawString(44, 270, "Contacto comercial")
    para(
        c,
        "Juan Carlos Gomez · Bogotá, Colombia",
        44,
        240,
        300,
        10.5,
        HexColor("#D1E1F6"),
        15,
    )
    para(
        c,
        "WhatsApp: +57 301 397 1483 · Correo: eslost07@gmail.com",
        44,
        211,
        400,
        10.5,
        HexColor("#D1E1F6"),
        15,
    )
    para(
        c,
        "Términos de uso: booksmart.is-local.org/terminos-de-uso/",
        44,
        182,
        400,
        9,
        HexColor("#AFC6E5"),
        13,
    )
    c.setFillColor(WHITE)
    font(c, "UbuntuBold", 12)
    c.drawString(44, 105, "BOOKSMART")
    c.setFillColor(CYAN)
    font(c, "UbuntuBold", 8)
    c.drawString(44, 88, "LA PLATAFORMA PARA NEGOCIOS QUE ATIENDEN POR CITA")
    footer(c, 10, True)


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
    c.setTitle("BookSmart - Propuesta comercial")
    c.setAuthor("BookSmart")
    for page in [
        page_cover,
        page_problem,
        page_flow,
        page_booking,
        page_ai,
        page_price,
        page_support,
        page_offerings,
        page_proof,
        page_cta,
    ]:
        page(c)
        c.showPage()
    c.save()
    print(OUT)


if __name__ == "__main__":
    main()
