"""Build products.seed.json (with per-depot prices + aliases) and parties.json
from the authoritative 'sec estimate' workbook plus a few legacy products and
hand-authored aliases drawn from real order handwriting."""
import json, re, os

LOCS = ["Narayanghat", "Butwal", "Pokhara", "Birganj"]

def price(ngt, btl, pkr, brj):
    return {"Narayanghat": ngt, "Butwal": btl, "Pokhara": pkr, "Birganj": brj}

# name, category, unit, prices, aliases
DATA = [
 ("ASCORIL - D COUGH SYRUP 100ML","DERMA","100ML",price(80.19,80.19,80.19,80.19),
   ["ascoril d","ascoril-d","ascoril d syrup","ascoril d syp","ascoril d syrup 100ml","ascoril d cough syrup"]),
 ("ASCORIL-BT EXPECTORANT 100 ML","DERMA","100ML",price(67.80,67.80,67.80,67.80),
   ["ascoril bt","ascoril-bt","ascoril et","ascoril bt expectorant","ascoril b t"]),
 ("Candid Cream 30 gm","DERMA","30GM",price(73.49,74.71,74.71,74.71),
   ["candid cream","candid cream 30gm","candid plain cream 30gm","candid plain cream","candid crm 30gm"]),
 ("CANDID LOTION 30 ML","DERMA","30ML",price(95.28,97.00,97.00,97.00),
   ["candid lotion","candid lotion 30ml","candid cotton 30ml","candid lotion 30 ml"]),
 ("CANDID POWDER 100 GM","DERMA","100GM",price(99.88,99.88,99.88,99.88),
   ["candid powder","candid powder 100gm","candid powder 100 gm"]),
 ("D'ACNE FOAMING FACE WASH 60 ML","SKIN CARE","60ML",price(292.35,292.35,292.35,292.35),
   ["d acne face wash","dacne face wash","d'acne forming face wash","d acne foaming face wash","d acne foaming face wash 60ml","dacne foaming face wash"]),
 ("D'ACNE GEL 10 GM","DERMA","10GM",price(128.67,128.67,128.67,128.67),
   ["d acne gel","dacne gel","d'acne gel","d acne gel 10gm"]),
 ("D'ACNE SOFT 100 GM","SKIN CARE","100GM",price(234.59,234.59,234.59,234.59),
   ["d acne soft","dacne soft","d'acne soft","d acne soft 100gm"]),
 ("DERIVA MS GEL IN 15 GM","DERMA","15GM",price(275.57,282.27,282.27,282.27),
   ["deriva ms gel","deriva ms gel 15gm","desiva ms gel","deriva ms gel in 15 gm","deriva gel 15gm"]),
 ("ELOVERA CREAM 150 GM","SKIN CARE","150GM",price(199.67,209.11,209.11,209.11),
   ["elovera cream 150gm","elovera 150 gm crm","elovera cream 150 gm","elovera 150gm cream"]),
 ("ELOVERA CREAM 75 GM","SKIN CARE","75GM",price(128.92,152.51,152.51,152.51),
   ["elovera cream 75gm","elovera 75 gm crm","elovera cream 75 gm"]),
 ("ELOVERA MOISTURIZING BODY WASH 250 ML","SKIN CARE","250ML",price(323.93,323.93,323.93,323.93),
   ["elovera body wash","elovera moisturizing body wash","elovera moisturising body wash"]),
 ("ELOVERA PRO CREAM 75 G","SKIN CARE","75GM",price(176.09,190.24,190.24,190.24),
   ["elovera pro cream","elovera pro max cream","elovera pro cream 75g","elovera pro cream 75 gm"]),
 ("ELOVERA PRO LOTION 150 G","SKIN CARE","150GM",price(286.93,286.93,286.93,286.93),
   ["elovera pro lotion","elovera pro max lotion","elovera pro lotion 150g"]),
 ("GLENMARK BILAZAP TABLET 10'S","DERMA","10'S",price(118.83,111.41,111.41,111.41),
   ["bilazap","bilazap tablet","glenmark bilazap","bilazap tab","bilazap 10s"]),
 ("LA SHIELD LITE GEL SPF 50+50 GM","SKIN CARE","50GM",price(513.59,513.59,513.59,513.59),
   ["la shield lite","la shield lite gel","lashield lite","la shield lite spf 50"]),
 ("LA SHIELD SUNSCREEN GEL SPF 40 50 GM","SKIN CARE","50GM",price(445.46,445.46,445.46,445.46),
   ["la shield sunscreen","la shield gel","la shield gel 60ml","la shield sunscreen gel","lashield sunscreen","la shield spf 40"]),
 ("LULICAN CREAM 20 GM","DERMA","20GM",price(116.19,116.19,116.19,116.19),
   ["lulican cream 20gm","lulican 20 gms","lulican cream 20 gm","lulican 20gm"]),
 ("LULICAN CREAM 30 GM","DERMA","30GM",price(273.38,273.38,273.38,273.38),
   ["lulican cream 30gm","lulican 30 gms","lulican cream 30 gm","lulican 30gm","lulican cream"]),
 ("LULICAN LOTION 30 ML","DERMA","30ML",price(177.70,177.70,177.70,177.70),
   ["lulican lotion","lulican lotion 30ml","lulican lotion 30 ml"]),
 ("NEW HAIR4U 2% 60 ML","HAIR CARE","60ML",price(188.67,196.24,196.24,196.24),
   ["hair 4 u 2%","hair4u 2%","new hair 4u 2%","hair 4u 2%","new hair4u 2%","hair4u2%","hair 40 2%"]),
 ("NEW HAIR4U 5% 60 ML","HAIR CARE","60ML",price(444.61,456.31,456.31,456.31),
   ["hair 4 u 5%","hair4u 5%","new hair 4u 5%","hair 4u 5%","new hair4u 5%","hair 40 5%"]),
 ("NEW HAIR4U 10% 60 ML","HAIR CARE","60ML",price(504.38,552.30,552.30,552.30),
   ["hair 4 u 10%","hair4u 10%","new hair 4u 10%","hair 4u 10%","hair 40 10%"]),
 ("HAIR 4 U SHAMPOO 100 ML","HAIR CARE","100ML",price(197.69,197.69,197.69,197.69),
   ["hair 4u shampoo","hair4u shampoo","hair 40 shampoo","new hair 4u shampoo","hair 4 u shampoo"]),
 ("SCALPE + SHAMPOO 75ML","HAIR CARE","75ML",price(167.14,169.47,169.47,169.47),
   ["scalpe shampoo","scalpe+","scalpe + shampoo","scalpe shampoo 75ml","scalpe plus shampoo","scalpe+ shampoo","scalpe lotion"]),
 ("BONTRESS PRO + SCALP SERUM 60 ML","HAIR CARE","60ML",price(788.82,786.11,786.11,786.11),
   ["bontress pro +","bontress","bontress pro plus","bontress pro + scalp serum","bontress serum","bontress pro plus scalp serum"]),
 ("RELCER GEL 180ml","DERMA","180ML",price(64.00,72.17,72.17,72.17),
   ["relcer gel","relcer","relcer gel 180ml","relcer gel 180 ml"]),
]

# Legacy Glenmark products present in the older master but not in this estimate;
# keep them so real orders that mention them still match. Single price for all depots.
def flat(p): return price(p, p, p, p)
LEGACY = [
 ("MOMATE CREAM 20GM","DERMA","20GM",flat(217.25),["momate cream","momate cream 20gm","momate crm 20gm"]),
 ("MOMATE OINTMENT 15 GM","DERMA","15GM",flat(206.31),["momate ointment","momate oint 15gm","momate ointment 15gm"]),
 ("MOMATE-F","DERMA",None,flat(227.45),["momate f","momate-f","momate f cream"]),
 ("SUPIROCIN OINT 5 GM","DERMA","5GM",flat(82.74),["supirocin oint","supirocin ointment 5gm","supirocin oint 5gm"]),
 ("SUPIROCIN -B- OINT 5 GMS","DERMA","5GM",flat(135.60),["supirocin b oint","supirocin-b oint 5gm","supirocin b ointment"]),
 ("CANDID POWDER 50 GM","DERMA","50GM",flat(58.32),["candid powder 50gm","candid powder 50 gm"]),
]

def slug(s):
    return re.sub(r"[^A-Z0-9]+","-", s.upper()).strip("-")

def build(entries):
    out=[]
    for name,cat,unit,prices,aliases in entries:
        # Pricing is uniform across all depots; use the Birganj (brj) price
        # (Narayanghat figures were wrong).
        uniform = prices.get("Birganj", prices.get("Narayanghat"))
        prices_all = {loc: uniform for loc in LOCS}
        out.append({
            "name":name, "code":slug(name), "unit":unit, "category":cat,
            "price":uniform, "prices":prices_all,
            "aliases":sorted(set(aliases)),
        })
    return out

products = build(DATA) + build(LEGACY)

# Parties per depot (cleaned: drop TOTAL / STOCKISTS placeholders, de-dupe, title-case).
raw_parties = {
 "Narayanghat":["planet","anupam","sunny sumit","jaspaal","navajiwan","sriyanka","surya","national","janapremi","ashish"],
 "Butwal":["sunrise","batauli","suprim","krishna","kamana","munal","moonlight","sayapatri","global"],
 "Pokhara":["star medico","srijana","yunesh","asia","annapurna medico","rusha","dynamic","babina","shree krishna","himshree","pukar"],
 "Birganj":["united","kalyani","patel","wings","gupta n sons","sachin","sati","rantoks","capital","savitri","fairdeal"],
}
parties = {loc: sorted({p.strip().title() for p in ps if p.strip()}) for loc,ps in raw_parties.items()}

here = os.path.dirname(os.path.abspath(__file__))
json.dump(products, open(os.path.join(here,"products.seed.json"),"w",encoding="utf-8"), indent=2, ensure_ascii=False)
json.dump(parties, open(os.path.join(here,"parties.json"),"w",encoding="utf-8"), indent=2, ensure_ascii=False)
print(f"products: {len(products)} | parties: {sum(len(v) for v in parties.values())}")
for p in products: print(f"  {p['category']:10} {p['name']:38} {p['prices']}")
