import json
import math
import re
import unicodedata
from pathlib import Path

import pandas as pd

SRC = r"C:\projetosmq\nevoeiro\jveiga\Planilha_Rede_Cooperacao_PPG_CLIAMB.xlsx"
OUT = Path(r"C:\projetosmq\nevoeiro\data\cliamb-rede-cooperacao.json")
OUT_JS = Path(r"C:\projetosmq\nevoeiro\joseveiga\data.js")

# --- canonical institution name -> (city, country, lat, lon) -------------------
INSTITUICOES = {
    "Universidade Federal do Amazonas": ("Manaus", "Brasil", -3.1190, -60.0217),
    "Universidade Estadual Paulista Júlio de Mesquita Filho": ("São Paulo", "Brasil", -23.5505, -46.6333),
    "Instituto Nacional de Pesquisas Espaciais": ("São José dos Campos", "Brasil", -23.2237, -45.9009),
    "Universidade Federal de Pernambuco": ("Recife", "Brasil", -8.0476, -34.8770),
    "Universidade Federal da Paraíba": ("João Pessoa", "Brasil", -7.1195, -34.8450),
    "Faculdade Marechal Rondon": ("Vilhena", "Brasil", -12.7406, -60.1458),
    "Instituto Federal de Educação, Ciência e Tecnologia do Amazonas": ("Manaus", "Brasil", -3.1190, -60.0217),
    "Universidade do Estado do Amazonas": ("Manaus", "Brasil", -3.1190, -60.0217),
    "Universidade Federal do Mato Grosso": ("Cuiabá", "Brasil", -15.6014, -56.0979),
    "University of Oxford": ("Oxford", "Reino Unido", 51.7520, -1.2577),
    "Universidade da California, Irvine": ("Irvine", "Estados Unidos", 33.6846, -117.8265),
    "Instituto Max Planck de Química": ("Mainz", "Alemanha", 49.9929, 8.2473),
    "Universidade de Michigan": ("Ann Arbor", "Estados Unidos", 42.2808, -83.7430),
    "Instituto de Avaliação Ambiental e Investigação da Água": ("Barcelona", "Espanha", 41.3874, 2.1686),
    "Centro de Pesquisa Ecológica e Aplicações Florestais": ("Barcelona", "Espanha", 41.5000, 2.1000),
    "Universidade de Yale": ("New Haven", "Estados Unidos", 41.3083, -72.9279),
    "Instituto de Tecnologia de Karlsruhe": ("Karlsruhe", "Alemanha", 49.0069, 8.4037),
    "Instituto do Chipre": ("Nicósia", "Chipre", 35.1856, 33.3823),
    "Instituto Nacional de Pesquisas da Amazônia": ("Manaus", "Brasil", -3.1190, -60.0217),
    "Universidade de São Paulo": ("São Paulo", "Brasil", -23.5505, -46.6333),
    "Universidade Federal de São Paulo": ("São Paulo", "Brasil", -23.5505, -46.6333),
    "Universidade Estadual Santa Cruz": ("Ilhéus", "Brasil", -14.7889, -39.0494),
    "Universidad Nacional Autónoma de México": ("Cidade do México", "México", 19.4326, -99.1332),
    "University of Colorado Boulder": ("Boulder", "Estados Unidos", 40.0150, -105.2705),
    "UK Met Office": ("Exeter", "Reino Unido", 50.7184, -3.5339),
    "University of Manchester": ("Manchester", "Reino Unido", 53.4808, -2.2426),
    "University of Leeds": ("Leeds", "Reino Unido", 53.8008, -1.5491),
    "University of Illinois Urbana-Champaign": ("Urbana-Champaign", "Estados Unidos", 40.1106, -88.2073),
    "University of Indianapolis": ("Indianápolis", "Estados Unidos", 39.7684, -86.1581),
    "University of Sydney": ("Sydney", "Austrália", -33.8688, 151.2093),
    "UNITAU": ("Taubaté", "Brasil", -23.0206, -45.5553),
    "Institut de Recherche pour le Développement": ("Marseille", "França", 43.2965, 5.3698),
    "Universidade Federal Fluminense": ("Niterói", "Brasil", -22.8833, -43.1036),
    "Université Mohammed VI Polytechnique": ("Ben Guerir", "Marrocos", 32.2358, -7.9536),
    "Institut de Physique du Globe de Paris": ("Paris", "França", 48.8566, 2.3522),
    "Universidade Federal de Goiás": ("Goiânia", "Brasil", -16.6869, -49.2648),
    "Universidade Federal do Oeste do Pará": ("Santarém", "Brasil", -2.4431, -54.7083),
    "University of Texas at Austin": ("Austin", "Estados Unidos", 30.2672, -97.7431),
    "Instituto Mamirauá": ("Tefé", "Brasil", -3.3541, -64.7112),
    "Serviço Geológico do Brasil": ("Brasília", "Brasil", -15.7942, -47.8822),
    "Fundação Cearense de Meteorologia e Hidrologia": ("Fortaleza", "Brasil", -3.7172, -38.5433),
    "Instituto Geofísico del Peru": ("Lima", "Peru", -12.0464, -77.0428),
    "Servicio de Meteorologia y Hidrologia de Peru": ("Lima", "Peru", -12.0464, -77.0428),
    "Universidad Mayor de San Andrés": ("La Paz", "Bolívia", -16.5000, -68.1500),
    "Université de Toulouse/GET": ("Toulouse", "França", 43.6047, 1.4442),
    "Universidade de Évora": ("Évora", "Portugal", 38.5714, -7.9135),
    "Universidad Del Valle": ("Cali", "Colômbia", 3.4516, -76.5320),
    "Universidade Federal do Paraná": ("Curitiba", "Brasil", -25.4284, -49.2733),
    "Harvard University": ("Cambridge", "Estados Unidos", 42.3736, -71.1097),
    "Max Planck Institute": ("Mainz", "Alemanha", 49.9929, 8.2473),
    "Universidade Federal do Pará": ("Belém", "Brasil", -1.4558, -48.4902),
    "Universidade de Genebra": ("Genebra", "Suíça", 46.2044, 6.1432),
}

# --- typo/name normalization -> canonical institution name --------------------
INST_ALIASES = {
    "Instituito Nacional de Pequisas Espaciais": "Instituto Nacional de Pesquisas Espaciais",
    "Insituto Nacional de Pesquisas Espaciais": "Instituto Nacional de Pesquisas Espaciais",
    "Instituto de Pesquisa da Amazônia": "Instituto Nacional de Pesquisas da Amazônia",
    "University os Colorado Boulder": "University of Colorado Boulder",
    "University of Ilinois": "University of Illinois Urbana-Champaign",
    "Universisty of Sydney": "University of Sydney",
    "Universidade Mayor de San Andreas": "Universidad Mayor de San Andrés",
    "Instut de Phisique du Globe de Paris": "Institut de Physique du Globe de Paris",
    "Universite Mohamed VI": "Université Mohammed VI Polytechnique",
    "Universidade de Oxford": "University of Oxford",
    "Universidade de Genébra": "Universidade de Genebra",
    "Universidade federal do Pará": "Universidade Federal do Pará",
    # row 67 data-entry mismatch: institution name says "Universidade de Brasília" but the
    # sigla ("UT-Austin") and País ("Estados Unidos") both point to UT Austin. Resolved to
    # UT Austin pending final confirmation from the user.
    "Universidade de Brasília": "University of Texas at Austin",
    "Institut de Recherche pour le Developpement": "Institut de Recherche pour le Développement",
}

PAIS_FIX = {
    "Universite Mohamed VI": "Marrocos",
    "Universidade de Genébra": "Suíça",
}

DOCENTE_ALIASES = {
    "Jair Max Furtunato Maia": "Jair Max Furtado Maia",
}

# normaliza o texto livre de "Tipo de cooperação" (misto de ';', ',' e 'e') em tags
TIPO_ALIASES = {
    "pesquisa": "Pesquisa científica",
    "pesquisa científica": "Pesquisa científica",
    "publicação": "Publicação científica",
    "publicação científica": "Publicação científica",
    "publicação conjunta": "Publicação científica",
    "artigos": "Publicação científica",
    "coorientação": "Coorientação",
    "coorientações": "Coorientação",
    "orientação": "Orientação conjunta",
    "orientação conjunta": "Orientação conjunta",
    "projeto científico": "Projeto científico",
    "disciplina": "Disciplina",
    "disciplinas": "Disciplina",
    "mobilidade estudantil": "Mobilidade estudantil",
}

TIPO_SPLIT_RE = re.compile(r"\s*;\s*|\s*,\s*|\s+e\s+", re.IGNORECASE)


def split_tipos(raw) -> list:
    if pd.isna(raw):
        return []
    tokens = [t.strip(" .") for t in TIPO_SPLIT_RE.split(str(raw)) if t.strip(" .")]
    tags = []
    for t in tokens:
        canon = TIPO_ALIASES.get(t.casefold(), t[:1].upper() + t[1:])
        if canon not in tags:
            tags.append(canon)
    return tags


def norm_tokens(name: str):
    n = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return [t for t in re.split(r"[^a-z]+", n) if t]


def find_docente_match(colab_nome: str, docente_nodes: list):
    """Se o(a) colaborador(a) listado(a) é, na verdade, outro(a) docente do PPG-CLIAMB
    (ex.: 'José Augusto Veiga' == docente 'José Veiga'), devolve o id do(a) docente."""
    ct = norm_tokens(colab_nome)
    if len(ct) < 2:
        return None
    for d in docente_nodes:
        dt = norm_tokens(d["nome"])
        shorter, longer = (ct, dt) if len(ct) <= len(dt) else (dt, ct)
        if len(shorter) >= 2 and shorter[0] == longer[0] and shorter[-1] == longer[-1]:
            return d["id"]
    return None


def fmt_desde(value) -> str | None:
    if pd.isna(value):
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def slugify(name: str) -> str:
    n = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    n = re.sub(r"[^a-zA-Z0-9]+", "-", n).strip("-").lower()
    return n


def main():
    df = pd.read_excel(SRC, sheet_name="Cooperações")
    df = df.dropna(subset=["Instituição", "Pesquisador(a) colaborador(a)"]).copy()

    df["Docente PPG-CLIAMB"] = df["Docente PPG-CLIAMB"].str.strip().replace(DOCENTE_ALIASES)
    df["Instituição"] = df["Instituição"].str.strip()
    df["Instituição"] = df["Instituição"].replace(INST_ALIASES)

    unresolved = sorted(set(df["Instituição"]) - set(INSTITUICOES))
    if unresolved:
        raise SystemExit(f"Instituições sem coordenadas: {unresolved}")

    # docente nodes, clustered on Manaus
    docentes_nomes = sorted(df["Docente PPG-CLIAMB"].dropna().unique())
    manaus = (-3.1190, -60.0217)
    docente_nodes = []
    n = len(docentes_nomes)
    for i, nome in enumerate(docentes_nomes):
        angle = 2 * math.pi * i / n
        radius = 0.55
        lat = manaus[0] + radius * math.sin(angle)
        lon = manaus[1] + radius * math.cos(angle) / math.cos(math.radians(manaus[0]))
        docente_nodes.append({
            "id": f"doc-{slugify(nome)}",
            "nome": nome,
            "tipo": "docente",
            "instituicao": "PPG-CLIAMB / INPA-UEA",
            "cidade": "Manaus",
            "pais": "Brasil",
            "lat": round(lat, 5),
            "lon": round(lon, 5),
        })
    docente_id_by_name = {d["nome"]: d["id"] for d in docente_nodes}

    # colaboradores que na verdade são outro(a) docente do PPG-CLIAMB (nome com variação)
    match_cache = {}
    def docente_match(colab_nome):
        if colab_nome not in match_cache:
            match_cache[colab_nome] = find_docente_match(colab_nome, docente_nodes)
        return match_cache[colab_nome]

    # collaborator nodes: dedupe by (nome normalizado, instituição)
    colaborador_nodes = {}
    colaborador_order = []
    edges = []

    # group by city so co-located collaborators get spread in a small circle
    by_city = {}
    for _, row in df.iterrows():
        inst = row["Instituição"]
        cidade, pais, lat, lon = INSTITUICOES[inst]
        colab_nome = str(row["Pesquisador(a) colaborador(a)"]).strip()
        if docente_match(colab_nome):
            continue  # já existe como nó docente, não cria colaborador duplicado
        key = (colab_nome.casefold(), inst)
        if key not in colaborador_nodes:
            colaborador_nodes[key] = {
                "id": f"col-{slugify(colab_nome)}-{slugify(inst)}",
                "nome": colab_nome,
                "tipo": "colaborador",
                "instituicao": inst,
                "sigla": None if pd.isna(row["Sigla da instituição"]) else str(row["Sigla da instituição"]).strip(),
                "cidade": cidade,
                "pais": pais,
                "lat_base": lat,
                "lon_base": lon,
            }
            colaborador_order.append(key)
            by_city.setdefault((lat, lon), []).append(key)

    for (lat, lon), keys in by_city.items():
        m = len(keys)
        for i, key in enumerate(keys):
            if m == 1:
                jlat, jlon = lat, lon
            else:
                angle = 2 * math.pi * i / m
                radius = 0.12 + 0.015 * m
                jlat = lat + radius * math.sin(angle)
                jlon = lon + radius * math.cos(angle) / math.cos(math.radians(lat if lat else 0.0001))
            node = colaborador_nodes[key]
            node["lat"] = round(jlat, 5)
            node["lon"] = round(jlon, 5)
            del node["lat_base"]
            del node["lon_base"]

    for _, row in df.iterrows():
        docente_nome = row["Docente PPG-CLIAMB"]
        inst = row["Instituição"]
        colab_nome = str(row["Pesquisador(a) colaborador(a)"]).strip()
        matched_docente_id = docente_match(colab_nome)
        if matched_docente_id:
            outro_id = matched_docente_id
        else:
            key = (colab_nome.casefold(), inst)
            outro_id = colaborador_nodes[key]["id"]
        tipos = split_tipos(row["Tipo de cooperação"])
        edges.append({
            "docente_id": docente_id_by_name[docente_nome],
            "colaborador_id": outro_id,
            "tipo_cooperacao": None if pd.isna(row["Tipo de cooperação"]) else str(row["Tipo de cooperação"]).strip(),
            "tipos": tipos,
            "area": None if pd.isna(row["Área/tema da colaboração"]) else str(row["Área/tema da colaboração"]).strip(),
            "desde": fmt_desde(row["Desde quando"]),
            "producao_conjunta": None if pd.isna(row["Produção científica conjunta?"]) else str(row["Produção científica conjunta?"]).strip(),
            "projeto": None if pd.isna(row["Projeto/Programa associado"]) else str(row["Projeto/Programa associado"]).strip(),
            "observacoes": None if pd.isna(row["Observações"]) else str(row["Observações"]).strip(),
        })

    tipos_unicos = sorted({t for e in edges for t in e["tipos"]})

    data = {
        "docentes": docente_nodes,
        "colaboradores": [colaborador_nodes[k] for k in colaborador_order],
        "colaboracoes": edges,
        "meta": {
            "fonte": "Planilha_Rede_Cooperacao_PPG_CLIAMB.xlsx",
            "total_docentes": len(docente_nodes),
            "total_colaboradores": len(colaborador_nodes),
            "total_colaboracoes": len(edges),
            "tipos_cooperacao": tipos_unicos,
            "avisos": [
                "Linha da planilha com Instituição 'Universidade de Brasília' e Sigla 'UT-Austin' foi "
                "resolvida como University of Texas at Austin (com base no País='Estados Unidos' da própria linha) "
                "-- pendente de confirmação final.",
                "INPE, UNESP, IFAM, IRD e Serviço Geológico do Brasil são multi-campus/multi-sede: "
                "a cidade usada é a da sede/campus principal, não necessariamente a unidade exata da parceria.",
            ],
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    js_payload = "window.REDE_COOPERACAO = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
    OUT_JS.write_text(js_payload, encoding="utf-8")

    print(f"OK: {len(docente_nodes)} docentes, {len(colaborador_nodes)} colaboradores, {len(edges)} colaborações")
    print(f"-> {OUT}")
    print(f"-> {OUT_JS}")


if __name__ == "__main__":
    main()
