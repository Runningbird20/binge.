import argparse
import json
import logging
import re
from html import unescape
from io import BytesIO
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

BASE_URL = "https://www.scriptslug.com/"
GRAPHQL_URL = "https://www.scriptslug.com/index.php?p=actions/graphql/api"
IMSDB_BASE_URL = "https://imsdb.com/"
EIGHTFLIX_BASE_URL = "https://8flix.com/"
EIGHTFLIX_SEARCH_API_URL = urljoin(EIGHTFLIX_BASE_URL, "wp-json/wp/v2/search")
EIGHTFLIX_FILM_PREFIX = urljoin(EIGHTFLIX_BASE_URL, "scripts/film/")
EIGHTFLIX_TV_PREFIX = urljoin(EIGHTFLIX_BASE_URL, "scripts/tv/")
EIGHTFLIX_TRANSCRIPTS_PREFIX = urljoin(EIGHTFLIX_BASE_URL, "transcripts/")
SUBSLIKESCRIPT_BASE_URL = "https://subslikescript.com/"
SUBSLIKESCRIPT_SEARCH_URL = urljoin(SUBSLIKESCRIPT_BASE_URL, "search")
SUBSLIKESCRIPT_MOVIE_PREFIX = urljoin(SUBSLIKESCRIPT_BASE_URL, "movie/")
SUBSLIKESCRIPT_SERIES_PREFIX = urljoin(SUBSLIKESCRIPT_BASE_URL, "series/")
BBC_WRITERS_BASE_URL = "https://www.bbc.co.uk/writers/scripts/"
BBC_FILMS_INDEX_URL = urljoin(BBC_WRITERS_BASE_URL, "films")
BBC_TV_INDEX_URLS = [
    urljoin(BBC_WRITERS_BASE_URL, "childrens"),
    urljoin(BBC_WRITERS_BASE_URL, "tv-comedy"),
    urljoin(BBC_WRITERS_BASE_URL, "tv-drama"),
    urljoin(BBC_WRITERS_BASE_URL, "whoniverse"),
]
DAILY_SCRIPT_BASE_URL = "https://www.dailyscript.com/"
DAILY_SCRIPT_MOVIE_INDEX_URLS = [
    urljoin(DAILY_SCRIPT_BASE_URL, "movie.html"),
    urljoin(DAILY_SCRIPT_BASE_URL, "movie_n-z.html"),
]
DAILY_SCRIPT_TV_INDEX_URL = urljoin(DAILY_SCRIPT_BASE_URL, "tv.html")
BLACKLIST_BASE_URL = "https://gointothestory.blcklst.com/"
BLACKLIST_SCRIPT_LINKS_URL = urljoin(BLACKLIST_BASE_URL, "script-download-links-9313356d361c")
AWESOMEFILM_BASE_URL = "https://www.awesomefilm.com/"
AWESOMEFILM_INDEX_URL = AWESOMEFILM_BASE_URL
SFY_BASE_URL = "https://sfy.ru/"
SFY_INDEX_URL = urljoin(SFY_BASE_URL, "scripts")
SCREENPLAYDB_BASE_URL = "http://www.screenplaydb.com/"
SCREENPLAYDB_FILM_ALL_URL = urljoin(SCREENPLAYDB_BASE_URL, "film/all")
MOVIE_SCRIPTS_AND_SCREENPLAYS_BASE_URL = "http://www.moviescriptsandscreenplays.com/"
MOVIE_SCRIPTS_AND_SCREENPLAYS_INDEX_URLS = [
    MOVIE_SCRIPTS_AND_SCREENPLAYS_BASE_URL,
    urljoin(MOVIE_SCRIPTS_AND_SCREENPLAYS_BASE_URL, "movie-scripts.html"),
    urljoin(MOVIE_SCRIPTS_AND_SCREENPLAYS_BASE_URL, "movie-scripts2.html"),
]
STUDIOBINDER_BASE_URL = "https://www.studiobinder.com/"
STUDIOBINDER_TV_SCRIPTS_URL = urljoin(STUDIOBINDER_BASE_URL, "blog/tv-scripts/")
SCRIPT_HIVE_BASE_URL = "https://www.scripthive.com/"
SCRIPT_HIVE_SUPABASE_URL = "https://ceyhlqhetmcpzpzzrppv.supabase.co"
SCRIPT_HIVE_FILES_API_URL = urljoin(SCRIPT_HIVE_SUPABASE_URL + "/", "rest/v1/files")
SCRIPT_HIVE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNleWhscWhldG1jcHpwenpycHB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI5MjE5MzIsImV4cCI6MjA1ODQ5NzkzMn0."
    "oMs4gqPFi2P70khV2TvsKo-9eRN4Lf_EopB_oABKY6E"
)
SCRIPT_HIVE_MOVIE_CATEGORY = "Film"
SCRIPT_HIVE_TV_CATEGORY = "Television"
MOVIE_FALLBACK_SOURCES = [
    "Script Slug",
    "IMSDb",
    "8FLiX",
    "Subs like Script",
    "BBC Writers",
    "Daily Script",
    "ScriptHive",
    "Go Into The Story",
    "AwesomeFilm",
    "Screenplays for You",
    "ScreenplayDB",
    "Movie Scripts and Screenplays",
]
TV_FALLBACK_SOURCES = [
    "Script Slug",
    "IMSDb",
    "8FLiX",
    "Subs like Script",
    "BBC Writers",
    "Daily Script",
    "ScriptHive",
    "StudioBinder",
]
IMSDB_TV_DISCOVERY_URLS = [
    urljoin(IMSDB_BASE_URL, "TV/"),
    IMSDB_BASE_URL,
    urljoin(IMSDB_BASE_URL, "all-scripts.html"),
]
IMSDB_MOVIE_DISCOVERY_URL = urljoin(IMSDB_BASE_URL, "all-scripts.html")
DEFAULT_CATALOG_ROOT = Path("public") / "catalog"
DEFAULT_OUTPUT_ROOT = Path("data") / "scripts"
DEFAULT_LOG_FILE = DEFAULT_OUTPUT_ROOT / "scrape.log"
REQUEST_TIMEOUT_SECONDS = 30
PDF_TIMEOUT_SECONDS = 60
DISCOVERY_PAGE_SIZE = 100
MATCH_LIMIT = 10

IMSDB_MOVIE_INDEX: list[dict[str, Any]] | None = None
IMSDB_TV_INDEX: list[dict[str, Any]] | None = None
BBC_MOVIE_INDEX: list[dict[str, Any]] | None = None
BBC_TV_INDEX: list[dict[str, Any]] | None = None
DAILY_SCRIPT_MOVIE_INDEX: list[dict[str, Any]] | None = None
DAILY_SCRIPT_TV_INDEX: list[dict[str, Any]] | None = None
BLACKLIST_MOVIE_INDEX: list[dict[str, Any]] | None = None
AWESOMEFILM_MOVIE_INDEX: list[dict[str, Any]] | None = None
SFY_MOVIE_INDEX: list[dict[str, Any]] | None = None
MOVIE_SCRIPTS_AND_SCREENPLAYS_MOVIE_INDEX: list[dict[str, Any]] | None = None
STUDIOBINDER_TV_INDEX: list[dict[str, Any]] | None = None

MOVIE_SEARCH_QUERY = """
query SearchMovieScripts($search: String!, $limit: Int) {
  scriptsEntries(type: ["filmScript"], search: $search, limit: $limit) {
    ... on filmScript_Entry {
      id
      uri
      url
      scriptTitle
      year
      synopsis
      comingSoon
      writers {
        ... on writer_Entry {
          title
          uri
        }
      }
      script {
        url
        title
        filename
      }
    }
  }
}
"""

SHOW_SEARCH_QUERY = """
query SearchSeries($search: String!, $limit: Int) {
  seriesEntries(search: $search, limit: $limit) {
    ... on series_Entry {
      id
      uri
      url
      title
      seriesTitle
      year
    }
  }
}
"""

SHOW_EPISODES_QUERY = """
query GetSeriesScripts($relationId: [QueryArgument], $offset: Int, $limit: Int) {
  scriptsEntries(relatedTo: $relationId, type: ["seriesScript"], offset: $offset, limit: $limit) {
    ... on seriesScript_Entry {
      id
      uri
      url
      episodeTitle
      seasonNumber
      episodeNumber
      year
      synopsis
      comingSoon
      seriesTitle {
        ... on series_Entry {
          id
          uri
          url
          seriesTitle
          year
        }
      }
      writers {
        ... on writer_Entry {
          title
          uri
        }
      }
      script {
        url
        title
        filename
      }
    }
  }
}
"""


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Read movie and TV titles from catalog JSONL files, search the web "
            "for matching script pages on Script Slug, save full script text as "
            "JSON, and write a progress log."
        )
    )
    parser.add_argument(
        "--mode",
        choices=("all", "movies", "tv"),
        default="all",
        help="Choose whether to scrape movies, TV episodes, or both.",
    )
    parser.add_argument(
        "--movie-limit",
        type=int,
        default=None,
        help="Only process the first N movie catalog entries.",
    )
    parser.add_argument(
        "--show-limit",
        type=int,
        default=None,
        help="Only process the first N TV show catalog entries.",
    )
    parser.add_argument(
        "--episode-limit",
        type=int,
        default=None,
        help="Only scrape the first N episodes per matched TV show.",
    )
    parser.add_argument(
        "--catalog-root",
        default=str(DEFAULT_CATALOG_ROOT),
        help="Folder containing catalog JSONL files.",
    )
    parser.add_argument(
        "--output-root",
        default=str(DEFAULT_OUTPUT_ROOT),
        help="Root folder for JSON output files.",
    )
    parser.add_argument(
        "--log-file",
        default=str(DEFAULT_LOG_FILE),
        help="File path for the progress log.",
    )
    return parser.parse_args()


def configure_logging(log_file: Path) -> logging.Logger:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("catalog_script_scraper")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    logger.propagate = False

    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")

    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    return logger


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/123.0 Safari/537.36"
            ),
            "Accept": "application/graphql-response+json, application/json, text/plain, */*",
            "Origin": BASE_URL.rstrip("/"),
            "Referer": BASE_URL,
        }
    )
    return session


def sanitize_path_part(value: str, fallback: str) -> str:
    sanitized = re.sub(r'[<>:"/\\|?*\x00-\x1F]+', "", str(value or ""))
    sanitized = re.sub(r"\s+", " ", sanitized).strip().rstrip(".")
    return sanitized[:120] or fallback


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def strip_html(value: str | None) -> str | None:
    if not value:
        return None
    return normalize_whitespace(re.sub(r"<[^>]+>", " ", value))


def extract_year(value: Any) -> int | None:
    if value is None:
        return None
    match = re.search(r"(19|20)\d{2}", str(value))
    return int(match.group(0)) if match else None


def normalize_title_for_match(value: str | None) -> str:
    text = normalize_whitespace(value).lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[\"'`’]", "", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return normalize_whitespace(text)


def build_search_terms(title: str) -> list[str]:
    terms: list[str] = []

    def add(value: str | None):
        candidate = normalize_whitespace(value)
        if candidate and candidate not in terms:
            terms.append(candidate)

    add(title)
    add(title.replace("&", "and"))
    add(re.sub(r"[\"'`’]", "", title))
    add(re.sub(r"\s*[:\-]\s*.*$", "", title))
    add(re.sub(r"\([^)]*\)", "", title))
    return terms


def graphql_request(session: requests.Session, query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
    response = session.post(
        GRAPHQL_URL,
        json={"query": query, "variables": variables or {}},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()

    if payload.get("errors"):
        raise ValueError(f"GraphQL request failed: {payload['errors']}")

    return payload["data"]


def fetch_html(session: requests.Session, url: str, timeout: int = REQUEST_TIMEOUT_SECONDS) -> str:
    response = session.get(url, timeout=timeout)
    response.raise_for_status()
    return response.text


def script_hive_headers() -> dict[str, str]:
    return {
        "apikey": SCRIPT_HIVE_ANON_KEY,
        "Authorization": f"Bearer {SCRIPT_HIVE_ANON_KEY}",
        "Accept": "application/json",
        "Origin": SCRIPT_HIVE_BASE_URL.rstrip("/"),
        "Referer": SCRIPT_HIVE_BASE_URL,
    }


def fetch_script_hive_rows(session: requests.Session, params: dict[str, str]) -> list[dict[str, Any]]:
    response = session.get(
        SCRIPT_HIVE_FILES_API_URL,
        params={"select": "*", "record_deleted": "is.false", **params},
        headers=script_hive_headers(),
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    return payload if isinstance(payload, list) else []


def paginate_graphql_entries(
    session: requests.Session,
    logger: logging.Logger,
    label: str,
    query: str,
    field_name: str,
    variables: dict[str, Any] | None = None,
    page_size: int = DISCOVERY_PAGE_SIZE,
    total_limit: int | None = None,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    offset = 0
    base_variables = dict(variables or {})

    while True:
        page_variables = {
            **base_variables,
            "offset": offset,
            "limit": page_size,
        }
        logger.info("%s: requesting page with offset=%s limit=%s", label, offset, page_size)
        data = graphql_request(session, query, page_variables)
        page_items = data.get(field_name) or []
        if total_limit is not None:
            remaining = max(total_limit - len(items), 0)
            page_items = page_items[:remaining]
        logger.info("%s: received %s item(s) at offset=%s", label, len(page_items), offset)

        if not page_items:
            break

        items.extend(page_items)
        if total_limit is not None and len(items) >= total_limit:
            break
        if len(page_items) < page_size:
            break

        offset += page_size

    logger.info("%s: resolved %s total item(s)", label, len(items))
    return items


def writer_names(entry: dict[str, Any]) -> list[str]:
    names = []
    for writer in entry.get("writers") or []:
        name = normalize_whitespace(writer.get("title"))
        if name:
            names.append(name)
    return names


def script_asset(entry: dict[str, Any]) -> dict[str, Any] | None:
    assets = entry.get("script") or []
    for asset in assets:
        url = normalize_whitespace(asset.get("url"))
        if url:
            return asset
    return None


def match_score(candidate_title: str | None, candidate_year: Any, target_title: str, target_year: Any) -> int:
    candidate_norm = normalize_title_for_match(candidate_title)
    target_norm = normalize_title_for_match(target_title)
    if not candidate_norm or not target_norm:
        return -1

    score = 0
    if candidate_norm == target_norm:
        score += 100
    elif candidate_norm in target_norm or target_norm in candidate_norm:
        score += 65

    candidate_tokens = set(candidate_norm.split())
    target_tokens = set(target_norm.split())
    score += min(len(candidate_tokens & target_tokens) * 8, 32)

    candidate_year_num = extract_year(candidate_year)
    target_year_num = extract_year(target_year)
    if candidate_year_num and target_year_num:
        if candidate_year_num == target_year_num:
            score += 20
        else:
            score -= min(abs(candidate_year_num - target_year_num), 10)

    return score


def is_plausible_title_match(
    candidate_title: str | None,
    candidate_year: Any,
    target_title: str,
    target_year: Any,
) -> bool:
    candidate_norm = normalize_title_for_match(candidate_title)
    target_norm = normalize_title_for_match(target_title)
    if not candidate_norm or not target_norm:
        return False

    if candidate_norm == target_norm:
        return True

    candidate_tokens = set(candidate_norm.split())
    target_tokens = set(target_norm.split())
    if not candidate_tokens or not target_tokens:
        return False

    overlap = len(candidate_tokens & target_tokens)
    overlap_ratio = overlap / max(len(candidate_tokens), len(target_tokens))
    if overlap_ratio < 0.6:
        return False

    candidate_year_num = extract_year(candidate_year)
    target_year_num = extract_year(target_year)
    if candidate_year_num and target_year_num and abs(candidate_year_num - target_year_num) > 1:
        return False

    return True


def select_best_match(
    candidates: list[dict[str, Any]],
    title_field: str,
    target_title: str,
    target_year: Any,
) -> dict[str, Any] | None:
    best_match = None
    best_score = -1

    for candidate in candidates:
        score = match_score(candidate.get(title_field), candidate.get("year"), target_title, target_year)
        if score > best_score and is_plausible_title_match(
            candidate.get(title_field),
            candidate.get("year"),
            target_title,
            target_year,
        ):
            best_match = candidate
            best_score = score

    return best_match if best_score >= 70 else None


def rank_match_candidates(
    candidates: list[dict[str, Any]],
    title_field: str,
    target_title: str,
    target_year: Any,
    year_field: str = "year",
) -> list[dict[str, Any]]:
    matches = [
        candidate
        for candidate in candidates
        if is_plausible_title_match(candidate.get(title_field), candidate.get(year_field), target_title, target_year)
    ]
    matches.sort(
        key=lambda candidate: (
            -match_score(candidate.get(title_field), candidate.get(year_field), target_title, target_year),
            -candidate.get("_format_bonus", 0),
            -len(candidate.get("writers") or []),
            normalize_title_for_match(candidate.get(title_field)),
        )
    )
    return matches


def script_hive_candidate_year(row: dict[str, Any]) -> int | None:
    return extract_year(row.get("Year") or row.get("Draft Date") or row.get("Title") or row.get("Script Title"))


def cleaned_script_hive_title(row: dict[str, Any]) -> str | None:
    script_title = normalize_whitespace(row.get("Script Title"))
    if script_title:
        return script_title

    raw_title = normalize_whitespace(row.get("Title"))
    if not raw_title:
        return None

    title = re.sub(r"\.[a-z0-9]+$", "", raw_title, flags=re.IGNORECASE)
    title = re.sub(r"_(Film|Television|Other|Short Film)_.*$", "", title, flags=re.IGNORECASE)
    title = title.replace("_", " ")
    title = re.sub(r"\s+", " ", title)
    return normalize_whitespace(title)


def split_script_hive_tv_title(row: dict[str, Any], fallback_show: str) -> tuple[str, str | None]:
    script_title = normalize_whitespace(row.get("Script Title"))
    if script_title:
        quoted_match = re.match(r"(.+?)\s*-\s*[\"“](.+?)[\"”]\s*$", script_title)
        if quoted_match:
            return (
                normalize_whitespace(quoted_match.group(1)) or fallback_show,
                normalize_whitespace(quoted_match.group(2)),
            )

        if " - " in script_title:
            show_name, episode_title = script_title.split(" - ", 1)
            clean_episode_title = normalize_whitespace(episode_title.strip(" \"'“”"))
            return normalize_whitespace(show_name) or fallback_show, clean_episode_title or None

    cleaned_title = cleaned_script_hive_title(row)
    return (cleaned_title or fallback_show or "Untitled Show"), None


def parse_script_hive_episode_numbers(value: Any) -> tuple[int | None, int | None]:
    match = re.search(r"(\d+)\s*x\s*(\d+)", normalize_whitespace(value), re.IGNORECASE)
    if not match:
        return None, None
    return int(match.group(1)), int(match.group(2))


def script_hive_title_variants(row: dict[str, Any], media_type: str) -> list[str]:
    variants: list[str] = []

    def add(value: str | None):
        candidate = normalize_whitespace(value)
        if candidate and candidate not in variants:
            variants.append(candidate)

    add(cleaned_script_hive_title(row))

    alternate_titles = normalize_whitespace(row.get("Alternate Titles"))
    if alternate_titles:
        add(alternate_titles)
        for part in re.split(r"\s*(?:;|\||/)\s*", alternate_titles):
            add(part)

    if media_type == "tv":
        show_name, _ = split_script_hive_tv_title(row, cleaned_script_hive_title(row) or "Untitled Show")
        add(show_name)

    return variants


def script_hive_document_bonus(row: dict[str, Any]) -> int:
    document_type = normalize_whitespace(row.get("Document Type")).lower()
    file_type = normalize_whitespace(row.get("Type")).lower()
    bonus = 0

    if any(token in document_type for token in ("script", "transcript", "dialogue")):
        bonus += 12
    elif not document_type and "pdf" in file_type:
        bonus += 5

    if any(
        token in document_type
        for token in (
            "bible",
            "guide",
            "outline",
            "pitch",
            "proposal",
            "premise",
            "deck",
            "storyboard",
            "notes",
            "coverage",
            "article",
            "presentation",
            "press kit",
            "lookbook",
        )
    ):
        bonus -= 20

    if normalize_whitespace(row.get("Pilot")).lower() == "yes":
        bonus += 2

    return bonus


def search_script_hive_rows(
    session: requests.Session,
    title: str,
    category: str,
    logger: logging.Logger,
    log_prefix: str,
) -> list[dict[str, Any]]:
    matched: dict[str, dict[str, Any]] = {}
    search_fields = ["Title", '"Script Title"', '"Alternate Titles"']

    for search_term in build_search_terms(title):
        logger.info("%s Searching ScriptHive for \"%s\" using term \"%s\"", log_prefix, title, search_term)
        for field in search_fields:
            rows = fetch_script_hive_rows(
                session,
                {
                    "Category": f"eq.{category}",
                    field: f"ilike.*{search_term}*",
                    "limit": str(MATCH_LIMIT),
                },
            )
            for row in rows:
                key = normalize_whitespace(row.get("file_id")) or normalize_whitespace(row.get("Title"))
                if key:
                    matched[key] = row

    return list(matched.values())


def ranked_script_hive_matches(
    rows: list[dict[str, Any]],
    target_title: str,
    target_year: Any,
    media_type: str,
) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []

    for row in rows:
        row_year = script_hive_candidate_year(row)
        best_title = None
        best_score = -1

        for title_variant in script_hive_title_variants(row, media_type):
            score = match_score(title_variant, row_year, target_title, target_year)
            if score > best_score and is_plausible_title_match(title_variant, row_year, target_title, target_year):
                best_title = title_variant
                best_score = score

        if best_score < 70:
            continue

        enriched = dict(row)
        enriched["_match_title"] = best_title
        enriched["_match_score"] = best_score + script_hive_document_bonus(row)
        matches.append(enriched)

    return sorted(
        matches,
        key=lambda item: (
            -(item.get("_match_score") or 0),
            normalize_title_for_match(item.get("_match_title")),
            normalize_whitespace(item.get("Draft Date")),
            normalize_whitespace(item.get("Title")).lower(),
        ),
    )


def search_script_hive_movie_entries(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> list[dict[str, Any]]:
    title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    year = catalog_movie.get("year") or catalog_movie.get("releaseDate")

    rows = search_script_hive_rows(session, title, SCRIPT_HIVE_MOVIE_CATEGORY, logger, log_prefix)
    matches = ranked_script_hive_matches(rows, title, year, "movie")
    if not matches:
        raise LookupError(f"No ScriptHive movie script match found for {title}")
    return matches


def search_script_hive_tv_entries(
    session: requests.Session,
    catalog_show: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> list[dict[str, Any]]:
    title = normalize_whitespace(catalog_show.get("title")) or "Untitled Show"
    year = catalog_show.get("year") or catalog_show.get("releaseDate")

    rows = search_script_hive_rows(session, title, SCRIPT_HIVE_TV_CATEGORY, logger, log_prefix)
    matches = ranked_script_hive_matches(rows, title, year, "tv")
    if not matches:
        raise LookupError(f"No ScriptHive TV script match found for {title}")

    deduped: dict[tuple[str, int | None, int | None, str], dict[str, Any]] = {}
    for row in matches:
        fallback_show = normalize_whitespace(row.get("_match_title")) or title
        show_name, episode_title = split_script_hive_tv_title(row, fallback_show)
        season_number, episode_number = parse_script_hive_episode_numbers(row.get("Episode #"))
        clean_episode_title = episode_title or normalize_whitespace(row.get("Script Title")) or normalize_whitespace(row.get("Title"))
        key = (
            normalize_title_for_match(show_name),
            season_number,
            episode_number,
            normalize_title_for_match(clean_episode_title),
        )

        enriched = dict(row)
        enriched["_show_name"] = show_name
        enriched["_episode_title"] = clean_episode_title or "Untitled Episode"
        enriched["_season_number"] = season_number
        enriched["_episode_number"] = episode_number

        existing = deduped.get(key)
        if existing and (existing.get("_match_score") or 0) >= (enriched.get("_match_score") or 0):
            continue
        deduped[key] = enriched

    return sorted(
        deduped.values(),
        key=lambda item: (
            1 if item.get("_season_number") is None else 0,
            item.get("_season_number") if item.get("_season_number") is not None else 9999,
            item.get("_episode_number") if item.get("_episode_number") is not None else 9999,
            normalize_title_for_match(item.get("_episode_title")),
            -(item.get("_match_score") or 0),
        ),
    )


def catalog_paths(catalog_root: Path) -> list[Path]:
    return sorted(path for path in catalog_root.glob("*.jsonl") if path.is_file())


def load_catalog_entries(
    catalog_root: Path,
    media_type: str,
    logger: logging.Logger,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    if not catalog_root.exists():
        raise FileNotFoundError(f"Catalog folder not found: {catalog_root}")

    paths = catalog_paths(catalog_root)
    if not paths:
        raise FileNotFoundError(f"No JSONL files found in catalog folder: {catalog_root}")

    logger.info("Scanning %s catalog JSONL file(s) from %s for mediaType=%s", len(paths), catalog_root, media_type)

    entries: list[dict[str, Any]] = []
    seen: set[tuple[str, int | None, str]] = set()

    for path in paths:
        with path.open("r", encoding="utf-8") as handle:
            for line_number, raw_line in enumerate(handle, start=1):
                line = raw_line.strip()
                if not line:
                    continue

                try:
                    item = json.loads(line)
                except json.JSONDecodeError as error:
                    logger.warning("Skipping invalid JSON at %s:%s (%s)", path, line_number, error)
                    continue

                if item.get("mediaType") != media_type:
                    continue

                title = normalize_whitespace(item.get("title"))
                if not title:
                    continue

                year = extract_year(item.get("year") or item.get("releaseDate"))
                key = (normalize_title_for_match(title), year, media_type)
                if key in seen:
                    continue

                seen.add(key)
                item["_catalog_path"] = str(path)
                item["_catalog_line"] = line_number
                entries.append(item)

                if limit is not None and len(entries) >= limit:
                    logger.info("Loaded %s %s catalog item(s) due to limit=%s", len(entries), media_type, limit)
                    return entries

    logger.info("Loaded %s unique %s catalog item(s)", len(entries), media_type)
    return entries


def search_movie_entry(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> tuple[dict[str, Any], str]:
    title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    year = catalog_movie.get("year") or catalog_movie.get("releaseDate")

    for search_term in build_search_terms(title):
        logger.info("%s Searching web for movie \"%s\" using term \"%s\"", log_prefix, title, search_term)
        data = graphql_request(
            session,
            MOVIE_SEARCH_QUERY,
            {"search": search_term, "limit": MATCH_LIMIT},
        )
        candidates = data.get("scriptsEntries") or []
        match = select_best_match(candidates, "scriptTitle", title, year)
        if match:
            return match, search_term

    raise LookupError(f"No movie script match found online for {title}")


def search_show_entry(
    session: requests.Session,
    catalog_show: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> tuple[dict[str, Any], str]:
    title = normalize_whitespace(catalog_show.get("title")) or "Untitled Show"
    year = catalog_show.get("year") or catalog_show.get("releaseDate")

    for search_term in build_search_terms(title):
        logger.info("%s Searching web for TV show \"%s\" using term \"%s\"", log_prefix, title, search_term)
        data = graphql_request(
            session,
            SHOW_SEARCH_QUERY,
            {"search": search_term, "limit": MATCH_LIMIT},
        )
        candidates = data.get("seriesEntries") or []
        match = select_best_match(candidates, "seriesTitle", title, year)
        if match:
            return match, search_term

    raise LookupError(f"No TV show script match found online for {title}")


def discover_imsdb_movie_index(session: requests.Session, logger: logging.Logger) -> list[dict[str, Any]]:
    global IMSDB_MOVIE_INDEX
    if IMSDB_MOVIE_INDEX is not None:
        return IMSDB_MOVIE_INDEX

    logger.info("Building IMSDb movie index from %s", IMSDB_MOVIE_DISCOVERY_URL)
    html = fetch_html(session, IMSDB_MOVIE_DISCOVERY_URL)
    soup = BeautifulSoup(html, "html.parser")
    discovered: dict[str, dict[str, Any]] = {}

    for link in soup.find_all("a", href=True):
        href = link["href"].strip()
        if not (href.startswith("/Movie Scripts/") and href.endswith(" Script.html")):
            continue

        title = href.split("/")[-1].replace(" Script.html", "").strip()
        metadata_url = urljoin(IMSDB_BASE_URL, href)
        discovered[metadata_url] = {
            "title": title,
            "metadata_url": metadata_url,
        }

    IMSDB_MOVIE_INDEX = sorted(discovered.values(), key=lambda item: normalize_whitespace(item["title"]).lower())
    logger.info("Built IMSDb movie index with %s title(s)", len(IMSDB_MOVIE_INDEX))
    return IMSDB_MOVIE_INDEX


def discover_imsdb_tv_index(session: requests.Session, logger: logging.Logger) -> list[dict[str, Any]]:
    global IMSDB_TV_INDEX
    if IMSDB_TV_INDEX is not None:
        return IMSDB_TV_INDEX

    discovered: dict[str, dict[str, Any]] = {}

    for url in IMSDB_TV_DISCOVERY_URLS:
        try:
            html = fetch_html(session, url)
        except requests.RequestException as error:
            logger.warning("Unable to read IMSDb TV discovery URL %s: %s", url, error)
            continue

        soup = BeautifulSoup(html, "html.parser")
        found_here = 0
        for link in soup.find_all("a", href=True):
            href = link["href"].strip()
            if not (href.startswith("/TV/") and href.endswith(".html")):
                continue

            show_url = urljoin(IMSDB_BASE_URL, href)
            show_name = href.split("/")[-1].replace(".html", "").strip()
            if show_url in discovered:
                continue

            discovered[show_url] = {
                "show_name": show_name,
                "show_url": show_url,
            }
            found_here += 1

        logger.info("IMSDb TV discovery from %s found %s show link(s)", url, found_here)

    IMSDB_TV_INDEX = sorted(discovered.values(), key=lambda item: normalize_whitespace(item["show_name"]).lower())
    logger.info("Built IMSDb TV index with %s show(s)", len(IMSDB_TV_INDEX))
    return IMSDB_TV_INDEX


def search_imsdb_movie_entry(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> dict[str, Any]:
    title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    year = catalog_movie.get("year") or catalog_movie.get("releaseDate")

    logger.info("%s Searching IMSDb for movie \"%s\"", log_prefix, title)
    candidates = discover_imsdb_movie_index(session, logger)
    match = select_best_match(candidates, "title", title, year)
    if not match:
        raise LookupError(f"No IMSDb movie script match found for {title}")
    return match


def search_imsdb_show_entry(
    session: requests.Session,
    catalog_show: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> dict[str, Any]:
    title = normalize_whitespace(catalog_show.get("title")) or "Untitled Show"
    year = catalog_show.get("year") or catalog_show.get("releaseDate")

    logger.info("%s Searching IMSDb for TV show \"%s\"", log_prefix, title)
    candidates = discover_imsdb_tv_index(session, logger)
    match = select_best_match(candidates, "show_name", title, year)
    if not match:
        raise LookupError(f"No IMSDb TV show transcript match found for {title}")
    return match


def extract_script_text_from_read_page(page_html: str) -> str:
    soup = BeautifulSoup(page_html, "html.parser")
    container = soup.find("td", class_="scrtext")
    if not container:
        raise ValueError("Could not find the script text container on the IMSDb read page.")

    pre_block = container.find("pre")
    text = pre_block.get_text() if pre_block else container.get_text()
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return text.strip()


def extract_sidebar_writers(soup: BeautifulSoup) -> list[str]:
    heading = soup.find("b", string=re.compile(r"^\s*Writers?\s*$", re.IGNORECASE))
    if not heading:
        return []

    writers = []
    for sibling in heading.next_siblings:
        if getattr(sibling, "name", None) == "b":
            break
        if getattr(sibling, "name", None) == "a":
            href = sibling.get("href", "")
            if "/writer.php" in href:
                name = normalize_whitespace(sibling.get_text(" ", strip=True))
                if name:
                    writers.append(name)

    return writers


def extract_read_link(soup: BeautifulSoup) -> str | None:
    for link in soup.find_all("a", href=True):
        href = link["href"].strip()
        if href.startswith("/scripts/") or href.startswith("/transcripts/"):
            return urljoin(IMSDB_BASE_URL, href)
    return None


def extract_movie_script_date(soup: BeautifulSoup) -> str | None:
    text = soup.get_text("\n", strip=True)
    match = re.search(r"Script Date\s*:\s*(.+)", text)
    return normalize_whitespace(match.group(1)) if match else None


def table_rows_to_dict(table: BeautifulSoup | None) -> dict[str, str]:
    if not table:
        return {}

    values: dict[str, str] = {}
    for row in table.find_all("tr"):
        cells = [normalize_whitespace(cell.get_text(" ", strip=True)) for cell in row.find_all(["th", "td"])]
        if len(cells) < 2:
            continue

        key = cells[0]
        value = cells[-1]
        if key and value:
            values[key] = value

    return values


def extract_8flix_logline(soup: BeautifulSoup) -> str | None:
    blockquote = soup.find("blockquote")
    if not blockquote:
        return None

    cite = blockquote.find("cite")
    if cite:
        cite.extract()

    text = normalize_whitespace(blockquote.get_text(" ", strip=True))
    return text or None


def maybe_extract_8flix_public_script_text(content_html: str) -> str:
    soup = BeautifulSoup(content_html, "html.parser")

    for tag in soup.find_all(["script", "style", "noscript"]):
        tag.decompose()

    for selector in [
        ("pre", {}),
        ("div", {"class": re.compile(r"(script|transcript|dialogue|teleplay)-text", re.IGNORECASE)}),
        ("section", {"class": re.compile(r"(script|transcript|dialogue|teleplay)-text", re.IGNORECASE)}),
    ]:
        node = soup.find(selector[0], selector[1])
        if node:
            text = node.get_text("\n", strip=True).replace("\r\n", "\n").replace("\r", "\n").strip()
            if text:
                return text

    text = soup.get_text("\n", strip=True).replace("\r\n", "\n").replace("\r", "\n").strip()
    if len(text) < 20000:
        return ""

    script_markers = [
        "FADE IN",
        "INT.",
        "EXT.",
        "CUT TO",
        "ACT ONE",
        "ACT TWO",
        "SCENE",
    ]
    upper_text = text.upper()
    if any(marker in upper_text for marker in script_markers):
        return text

    return ""


def search_8flix_entries(
    session: requests.Session,
    title: str,
    year: Any,
    logger: logging.Logger,
    log_prefix: str,
    allowed_prefixes: tuple[str, ...],
) -> list[dict[str, Any]]:
    matched: dict[str, dict[str, Any]] = {}

    for search_term in build_search_terms(title):
        logger.info("%s Searching 8FLiX for \"%s\" using term \"%s\"", log_prefix, title, search_term)
        response = session.get(
            EIGHTFLIX_SEARCH_API_URL,
            params={"search": search_term, "per_page": MATCH_LIMIT},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        results = response.json()

        for item in results:
            page_url = normalize_whitespace(item.get("url"))
            if not page_url or not any(page_url.startswith(prefix) for prefix in allowed_prefixes):
                continue

            page_title = normalize_whitespace(unescape(item.get("title")))
            score = match_score(page_title, extract_year(page_title), title, year)
            if score < 70:
                continue

            existing = matched.get(page_url)
            if existing and existing.get("_match_score", -1) >= score:
                continue

            matched[page_url] = {
                "id": item.get("id"),
                "title": page_title,
                "url": page_url,
                "api_url": (((item.get("_links") or {}).get("self") or [{}])[0]).get("href"),
                "_match_score": score,
            }

    ordered = sorted(
        matched.values(),
        key=lambda item: (
            -(item.get("_match_score") or 0),
            0 if item.get("url", "").startswith(EIGHTFLIX_TV_PREFIX) else 1,
            item.get("title", ""),
        ),
    )
    logger.info("%s 8FLiX matched %s candidate page(s) for %s", log_prefix, len(ordered), title)
    return ordered


def fetch_8flix_page_payload(session: requests.Session, page: dict[str, Any]) -> dict[str, Any]:
    api_url = normalize_whitespace(page.get("api_url"))
    if api_url:
        response = session.get(api_url, timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        return response.json()

    page_id = page.get("id")
    if not page_id:
        raise LookupError(f"8FLiX result missing page metadata for {page.get('title')}")

    response = session.get(
        urljoin(EIGHTFLIX_BASE_URL, f"wp-json/wp/v2/pages/{page_id}"),
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


def extract_8flix_episode_identity(value: str) -> tuple[int | None, int | None]:
    match = re.search(r"(\d+)\.(\d+)", normalize_whitespace(value))
    if not match:
        return None, None
    return int(match.group(1)), int(match.group(2))


def search_subslikescript_entries(
    session: requests.Session,
    title: str,
    year: Any,
    logger: logging.Logger,
    log_prefix: str,
    allowed_prefixes: tuple[str, ...],
) -> list[dict[str, Any]]:
    matched: dict[str, dict[str, Any]] = {}
    target_year = extract_year(year)

    for search_term in build_search_terms(title):
        logger.info("%s Searching Subs like Script for \"%s\" using term \"%s\"", log_prefix, title, search_term)
        response = session.get(
            SUBSLIKESCRIPT_SEARCH_URL,
            params={"q": search_term},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")

        for link in soup.find_all("a", href=True):
            href = normalize_whitespace(link.get("href"))
            page_url = urljoin(SUBSLIKESCRIPT_BASE_URL, href)
            if not any(page_url.startswith(prefix) for prefix in allowed_prefixes):
                continue

            page_title = normalize_whitespace(unescape(link.get_text(" ", strip=True)))
            candidate_year = extract_year(page_title)
            if target_year and candidate_year and candidate_year != target_year:
                continue

            score = match_score(page_title, candidate_year, title, year)
            if score < 70:
                continue

            existing = matched.get(page_url)
            if existing and existing.get("_match_score", -1) >= score:
                continue

            matched[page_url] = {
                "title": page_title,
                "url": page_url,
                "year": candidate_year,
                "_match_score": score,
            }

    ordered = sorted(
        matched.values(),
        key=lambda item: (
            -(item.get("_match_score") or 0),
            item.get("url", "").count("/season-"),
            item.get("title", ""),
        ),
    )
    logger.info("%s Subs like Script matched %s candidate page(s) for %s", log_prefix, len(ordered), title)
    return ordered


def extract_subslikescript_script_text(soup: BeautifulSoup) -> str:
    container = soup.find("div", class_="full-script")
    if not container:
        raise ValueError("Could not find the transcript container on the Subs like Script page.")

    return container.get_text("\n", strip=True).replace("\r\n", "\n").replace("\r", "\n").strip()


def extract_subslikescript_plot(soup: BeautifulSoup) -> str | None:
    plot = soup.find("p", class_="plot")
    if not plot:
        return None
    return normalize_whitespace(plot.get_text(" ", strip=True)) or None


def extract_subslikescript_heading(soup: BeautifulSoup) -> str:
    heading = soup.find("h1")
    return normalize_whitespace(heading.get_text(" ", strip=True)) if heading else ""


def extract_subslikescript_movie_title(heading: str, fallback: str) -> str:
    if not heading:
        return fallback

    title = re.sub(r"\s*\(\d{4}[^)]*\)\s*-\s*full transcript\s*$", "", heading, flags=re.IGNORECASE)
    title = re.sub(r"\s*-\s*full transcript\s*$", "", title, flags=re.IGNORECASE)
    return normalize_whitespace(title) or fallback


def extract_subslikescript_show_name(heading: str, fallback: str) -> str:
    if not heading:
        return fallback

    title = re.sub(r"\s*\(\d{4}[^)]*\)\s*-\s*episodes with scripts\s*$", "", heading, flags=re.IGNORECASE)
    title = re.sub(r"\s*-\s*episodes with scripts\s*$", "", title, flags=re.IGNORECASE)
    return normalize_whitespace(title) or fallback


def extract_subslikescript_episode_records(show_html: str, show_url: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(show_html, "html.parser")
    article = soup.find("article") or soup
    records: list[dict[str, Any]] = []
    seen: set[str] = set()

    for link in article.find_all("a", href=True):
        href = normalize_whitespace(link.get("href"))
        if "/season-" not in href or "/episode-" not in href:
            continue

        page_url = urljoin(SUBSLIKESCRIPT_BASE_URL, href)
        if page_url in seen:
            continue

        match = re.search(r"/season-(\d+)/episode-(\d+)-", href)
        if not match:
            continue

        seen.add(page_url)
        records.append(
            {
                "episode_title": normalize_whitespace(link.get_text(" ", strip=True)) or "Untitled Episode",
                "season_number": int(match.group(1)),
                "episode_number": int(match.group(2)),
                "page_url": page_url,
                "show_url": show_url,
            }
        )

    return records


def discover_bbc_movie_index(session: requests.Session, logger: logging.Logger) -> list[dict[str, Any]]:
    global BBC_MOVIE_INDEX
    if BBC_MOVIE_INDEX is not None:
        return BBC_MOVIE_INDEX

    logger.info("Building BBC Writers film index from %s", BBC_FILMS_INDEX_URL)
    soup = BeautifulSoup(fetch_html(session, BBC_FILMS_INDEX_URL), "html.parser")
    discovered: dict[str, dict[str, Any]] = {}

    for link in soup.find_all("a", href=True):
        href = normalize_whitespace(link.get("href"))
        page_url = urljoin(BBC_WRITERS_BASE_URL, href)
        if not page_url.startswith(urljoin(BBC_WRITERS_BASE_URL, "films/")):
            continue
        if page_url.rstrip("/") == BBC_FILMS_INDEX_URL.rstrip("/"):
            continue

        title = normalize_whitespace(link.get_text(" ", strip=True))
        if not title:
            continue

        discovered[page_url] = {
            "title": title,
            "page_url": page_url,
            "category": "films",
        }

    BBC_MOVIE_INDEX = sorted(discovered.values(), key=lambda item: normalize_title_for_match(item["title"]))
    logger.info("Built BBC Writers film index with %s title(s)", len(BBC_MOVIE_INDEX))
    return BBC_MOVIE_INDEX


def discover_bbc_tv_index(session: requests.Session, logger: logging.Logger) -> list[dict[str, Any]]:
    global BBC_TV_INDEX
    if BBC_TV_INDEX is not None:
        return BBC_TV_INDEX

    discovered: dict[str, dict[str, Any]] = {}
    for index_url in BBC_TV_INDEX_URLS:
        logger.info("Building BBC Writers TV index from %s", index_url)
        soup = BeautifulSoup(fetch_html(session, index_url), "html.parser")
        found_here = 0

        for link in soup.find_all("a", href=True):
            href = normalize_whitespace(link.get("href"))
            page_url = urljoin(BBC_WRITERS_BASE_URL, href)
            if not page_url.startswith(index_url.rstrip("/") + "/"):
                continue

            title = normalize_whitespace(link.get_text(" ", strip=True))
            if not title:
                continue

            if page_url not in discovered:
                discovered[page_url] = {
                    "title": title,
                    "page_url": page_url,
                    "category": index_url.rstrip("/").split("/")[-1],
                }
                found_here += 1

        logger.info("BBC Writers TV discovery from %s found %s show page(s)", index_url, found_here)

    BBC_TV_INDEX = sorted(discovered.values(), key=lambda item: normalize_title_for_match(item["title"]))
    logger.info("Built BBC Writers TV index with %s show(s)", len(BBC_TV_INDEX))
    return BBC_TV_INDEX


def search_bbc_movie_entry(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> dict[str, Any]:
    title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    year = catalog_movie.get("year") or catalog_movie.get("releaseDate")

    logger.info("%s Searching BBC Writers for movie \"%s\"", log_prefix, title)
    candidates = discover_bbc_movie_index(session, logger)
    match = select_best_match(candidates, "title", title, year)
    if not match:
        raise LookupError(f"No BBC Writers movie script match found for {title}")
    return match


def search_bbc_tv_entry(
    session: requests.Session,
    catalog_show: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> dict[str, Any]:
    title = normalize_whitespace(catalog_show.get("title")) or "Untitled Show"
    year = catalog_show.get("year") or catalog_show.get("releaseDate")

    logger.info("%s Searching BBC Writers for TV show \"%s\"", log_prefix, title)
    candidates = discover_bbc_tv_index(session, logger)
    match = select_best_match(candidates, "title", title, year)
    if not match:
        raise LookupError(f"No BBC Writers TV script match found for {title}")
    return match


def extract_bbc_page_summary(soup: BeautifulSoup) -> str | None:
    main = soup.find("main") or soup
    for node in main.find_all(["p", "div"], recursive=True):
        text = normalize_whitespace(node.get_text(" ", strip=True))
        if not text:
            continue
        if text.lower().startswith("copyright & content warning"):
            continue
        if text.lower().startswith("scripts"):
            continue
        if len(text) >= 30:
            return text
    return None


def extract_bbc_pdf_items(soup: BeautifulSoup) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen: set[str] = set()

    for link in soup.find_all("a", href=True):
        href = normalize_whitespace(link.get("href"))
        if not href.lower().endswith(".pdf"):
            continue

        pdf_url = urljoin(BBC_WRITERS_BASE_URL, href)
        if pdf_url in seen:
            continue
        seen.add(pdf_url)

        title = normalize_whitespace(link.get_text(" ", strip=True)) or "Untitled Script"
        parent = link.parent
        context = normalize_whitespace(parent.get_text("\n", strip=True)) if parent else title
        writer_match = re.search(r"\bby\s+(.+)$", context, re.IGNORECASE)
        writer_text = normalize_whitespace(writer_match.group(1)) if writer_match else ""
        writers = parse_people_list(writer_text)

        season_number = None
        episode_number = None
        match = re.search(r"Series\s+(\d+),\s*Episode\s+(\d+)", title, re.IGNORECASE)
        if match:
            season_number = int(match.group(1))
            episode_number = int(match.group(2))

        clean_title = re.sub(r"\s*-\s*Post Production Script\s*$", "", title, flags=re.IGNORECASE)
        items.append(
            {
                "title": normalize_whitespace(clean_title) or title,
                "label": title,
                "pdf_url": pdf_url,
                "writers": writers,
                "writer": ", ".join(writers),
                "season_number": season_number,
                "episode_number": episode_number,
            }
        )

    return items


def format_preference_bonus(format_name: str) -> int:
    normalized = normalize_whitespace(format_name).lower()
    bonuses = {
        "html": 5,
        "text": 4,
        "txt": 4,
        "pdf": 3,
        "doc": 0,
    }
    return bonuses.get(normalized, 1)


def parse_daily_script_entry(paragraph: BeautifulSoup, link: BeautifulSoup, media_type: str) -> dict[str, Any] | None:
    href = normalize_whitespace(link.get("href"))
    if not href.startswith("scripts/"):
        return None

    title = normalize_whitespace(link.get_text(" ", strip=True))
    if not title:
        return None

    chunks: list[str] = []
    for sibling in link.next_siblings:
        if getattr(sibling, "name", None) == "a" and normalize_whitespace(sibling.get_text(" ", strip=True)).lower() == "imdb":
            break
        if isinstance(sibling, str):
            text = normalize_whitespace(sibling)
        else:
            text = normalize_whitespace(sibling.get_text(" ", strip=True))
        if text:
            chunks.append(text)

    details = " ".join(chunks)
    details = normalize_whitespace(details.replace("???", " "))
    writer_match = re.search(r"\bby\s+(.+?)\s+((?:19|20)\d{2}|0)\b", details, re.IGNORECASE)
    writer_text = normalize_whitespace(writer_match.group(1)) if writer_match else ""
    writers = parse_people_list(writer_text)

    if href.lower().endswith(".pdf"):
        script_format = "pdf"
    elif href.lower().endswith(".doc"):
        script_format = "doc"
    elif href.lower().endswith((".txt", ".text")):
        script_format = "text"
    else:
        script_format = "html"

    return {
        "media_type": media_type,
        "title": title,
        "script_url": urljoin(DAILY_SCRIPT_BASE_URL, href),
        "writers": writers,
        "writer": ", ".join(writers),
        "year": extract_year(details),
        "details": details,
        "script_format": script_format,
        "_format_bonus": format_preference_bonus(script_format),
    }


def discover_daily_script_movie_index(session: requests.Session, logger: logging.Logger) -> list[dict[str, Any]]:
    global DAILY_SCRIPT_MOVIE_INDEX
    if DAILY_SCRIPT_MOVIE_INDEX is not None:
        return DAILY_SCRIPT_MOVIE_INDEX

    discovered: dict[str, dict[str, Any]] = {}
    for index_url in DAILY_SCRIPT_MOVIE_INDEX_URLS:
        logger.info("Building Daily Script movie index from %s", index_url)
        soup = BeautifulSoup(fetch_html(session, index_url), "html.parser")
        found_here = 0
        for paragraph in soup.find_all("p"):
            link = paragraph.find("a", href=True)
            if not link:
                continue
            item = parse_daily_script_entry(paragraph, link, "movie")
            if not item:
                continue
            script_url = item["script_url"]
            existing = discovered.get(script_url)
            if existing and existing.get("_format_bonus", 0) >= item["_format_bonus"]:
                continue
            discovered[script_url] = item
            found_here += 1
        logger.info("Daily Script movie discovery from %s found %s entry link(s)", index_url, found_here)

    DAILY_SCRIPT_MOVIE_INDEX = sorted(discovered.values(), key=lambda item: normalize_title_for_match(item["title"]))
    logger.info("Built Daily Script movie index with %s title(s)", len(DAILY_SCRIPT_MOVIE_INDEX))
    return DAILY_SCRIPT_MOVIE_INDEX


def discover_daily_script_tv_index(session: requests.Session, logger: logging.Logger) -> list[dict[str, Any]]:
    global DAILY_SCRIPT_TV_INDEX
    if DAILY_SCRIPT_TV_INDEX is not None:
        return DAILY_SCRIPT_TV_INDEX

    logger.info("Building Daily Script TV index from %s", DAILY_SCRIPT_TV_INDEX_URL)
    soup = BeautifulSoup(fetch_html(session, DAILY_SCRIPT_TV_INDEX_URL), "html.parser")
    discovered: dict[str, dict[str, Any]] = {}
    for paragraph in soup.find_all("p"):
        link = paragraph.find("a", href=True)
        if not link:
            continue
        item = parse_daily_script_entry(paragraph, link, "tv")
        if not item:
            continue
        discovered[item["script_url"]] = item

    DAILY_SCRIPT_TV_INDEX = sorted(discovered.values(), key=lambda item: normalize_title_for_match(item["title"]))
    logger.info("Built Daily Script TV index with %s episode entry(s)", len(DAILY_SCRIPT_TV_INDEX))
    return DAILY_SCRIPT_TV_INDEX


def search_daily_script_movie_entries(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> list[dict[str, Any]]:
    title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    year = catalog_movie.get("year") or catalog_movie.get("releaseDate")

    logger.info("%s Searching Daily Script for movie \"%s\"", log_prefix, title)
    candidates = discover_daily_script_movie_index(session, logger)
    matches = rank_match_candidates(candidates, "title", title, year)
    if not matches:
        raise LookupError(f"No Daily Script movie match found for {title}")
    return matches


def search_daily_script_tv_entries(
    session: requests.Session,
    catalog_show: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> list[dict[str, Any]]:
    title = normalize_whitespace(catalog_show.get("title")) or "Untitled Show"
    year = catalog_show.get("year") or catalog_show.get("releaseDate")
    target_norm = normalize_title_for_match(title)

    logger.info("%s Searching Daily Script for TV show \"%s\"", log_prefix, title)
    candidates = discover_daily_script_tv_index(session, logger)
    matches = [
        candidate
        for candidate in candidates
        if (
            is_plausible_title_match(candidate.get("title"), candidate.get("year"), title, year)
            or target_norm in normalize_title_for_match(candidate.get("title"))
        )
    ]
    matches.sort(
        key=lambda candidate: (
            -match_score(candidate.get("title"), candidate.get("year"), title, year),
            -candidate.get("_format_bonus", 0),
            normalize_title_for_match(candidate.get("title")),
        )
    )
    if not matches:
        raise LookupError(f"No Daily Script TV match found for {title}")
    return matches


def extract_daily_script_html_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    pre = soup.find("pre")
    if pre:
        return pre.get_text("\n", strip=True).replace("\r\n", "\n").replace("\r", "\n").strip()

    body = soup.body or soup
    text = body.get_text("\n", strip=True).replace("\r\n", "\n").replace("\r", "\n").strip()
    return text


def extract_daily_script_text(
    session: requests.Session,
    entry: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> tuple[str, int | None]:
    script_url = entry["script_url"]
    script_format = entry.get("script_format")
    logger.info("%s Daily Script source URL: %s", log_prefix, script_url)

    if script_format == "pdf":
        text, page_count = extract_pdf_text(session, script_url, logger, log_prefix)
        return text, page_count

    if script_format == "doc":
        raise LookupError(f"Daily Script matched {entry.get('title')}, but the available file is a .doc document.")

    response = session.get(script_url, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    raw_text = response.text
    if script_format == "text":
        text = raw_text.replace("\r\n", "\n").replace("\r", "\n").strip()
    else:
        text = extract_daily_script_html_text(raw_text)

    logger.info("%s Extracted %s characters from Daily Script %s source", log_prefix, len(text), script_format)
    return text, None


def has_script_markers(text: str) -> bool:
    upper_text = text.upper()
    return any(marker in upper_text for marker in ("FADE IN", "INT.", "EXT.", "CUT TO", "ACT ONE", "ACT TWO"))


def is_cloudflare_challenge_page(html: str) -> bool:
    text = normalize_whitespace(html).lower()
    return "just a moment..." in text and "_cf_chl_opt" in html


def clean_awesomefilm_title(raw_title: str) -> str:
    title = normalize_whitespace(raw_title)
    title = re.sub(r"\s*-\s*\((?:pdf|txt|html|doc)\)\s*(?:script|transcript)?\s*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s*\((?:pdf|txt|html|doc|transcript|script)\)\s*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\b(?:transcript|script)\b\s*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s*\([^)]*(?:draft|original title|screenplay|transcript|html|pdf|txt)[^)]*\)\s*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s+", " ", title).strip(" -")
    return normalize_whitespace(title)


def awesomefilm_format_from_href(href: str) -> str:
    href_lower = href.lower()
    if href_lower.endswith(".pdf"):
        return "pdf"
    if href_lower.endswith(".txt"):
        return "text"
    if href_lower.endswith(".doc"):
        return "doc"
    if href_lower.endswith(".html") or href_lower.endswith(".htm"):
        return "html"
    return "html"


def extract_awesomefilm_html_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all(["script", "style", "noscript"]):
        tag.decompose()

    body = soup.body or soup
    text = body.get_text("\n", strip=True).replace("\r\n", "\n").replace("\r", "\n").strip()
    return text


def discover_awesomefilm_movie_index(session: requests.Session, logger: logging.Logger) -> list[dict[str, Any]]:
    global AWESOMEFILM_MOVIE_INDEX
    if AWESOMEFILM_MOVIE_INDEX is not None:
        return AWESOMEFILM_MOVIE_INDEX

    logger.info("Building AwesomeFilm movie index from %s", AWESOMEFILM_INDEX_URL)
    soup = BeautifulSoup(fetch_html(session, AWESOMEFILM_INDEX_URL), "html.parser")
    discovered: dict[str, dict[str, Any]] = {}

    for anchor in soup.find_all("a", href=True):
        href = normalize_whitespace(anchor.get("href"))
        if not href.lower().startswith("script/"):
            continue

        raw_title = normalize_whitespace(anchor.get_text(" ", strip=True))
        if not raw_title:
            continue
        if raw_title.lower() in {"one", "two", "part 1", "part 2"}:
            continue

        script_url = urljoin(AWESOMEFILM_BASE_URL, href)
        script_format = awesomefilm_format_from_href(href)
        title = clean_awesomefilm_title(raw_title) or raw_title
        item = {
            "title": title,
            "raw_title": raw_title,
            "script_url": script_url,
            "script_format": script_format,
            "_format_bonus": format_preference_bonus(script_format),
        }

        existing = discovered.get(script_url)
        if existing and existing.get("_format_bonus", 0) >= item["_format_bonus"]:
            continue
        discovered[script_url] = item

    AWESOMEFILM_MOVIE_INDEX = sorted(discovered.values(), key=lambda item: normalize_title_for_match(item["title"]))
    logger.info("Built AwesomeFilm movie index with %s title link(s)", len(AWESOMEFILM_MOVIE_INDEX))
    return AWESOMEFILM_MOVIE_INDEX


def search_awesomefilm_movie_entries(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> list[dict[str, Any]]:
    title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    year = catalog_movie.get("year") or catalog_movie.get("releaseDate")

    logger.info("%s Searching AwesomeFilm for movie \"%s\"", log_prefix, title)
    candidates = discover_awesomefilm_movie_index(session, logger)
    matches = rank_match_candidates(candidates, "title", title, year, year_field="")
    if not matches:
        raise LookupError(f"No AwesomeFilm movie match found for {title}")
    return matches


def extract_awesomefilm_text(
    session: requests.Session,
    entry: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> tuple[str, int | None]:
    script_url = entry["script_url"]
    script_format = entry.get("script_format")
    logger.info("%s AwesomeFilm source URL: %s", log_prefix, script_url)

    if script_format == "pdf":
        text, page_count = extract_pdf_text(session, script_url, logger, log_prefix)
        return text, page_count

    if script_format == "doc":
        raise LookupError(f"AwesomeFilm matched {entry.get('title')}, but the available file is a .doc document.")

    response = session.get(script_url, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    raw_text = response.text
    if script_format == "text":
        text = raw_text.replace("\r\n", "\n").replace("\r", "\n").strip()
    else:
        text = extract_awesomefilm_html_text(raw_text)

    if not text or normalize_whitespace(text).lower().startswith("404 not found"):
        raise LookupError(f"AwesomeFilm matched {entry.get('title')}, but the linked page did not expose readable script text.")

    logger.info("%s Extracted %s characters from AwesomeFilm %s source", log_prefix, len(text), script_format)
    return text, None


def clean_sfy_title(raw_title: str) -> str:
    title = normalize_whitespace(raw_title)
    title = re.sub(r"\s+\(\d{4}\)\s*(?:transcript|script)?\s*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s+\b(?:transcript|script)\b\s*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s*\([^)]*transcript[^)]*\)\s*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s*\([^)]*script[^)]*\)\s*$", "", title, flags=re.IGNORECASE)
    return normalize_whitespace(title)


def sfy_format_from_href(href: str) -> str:
    href_lower = href.lower()
    if "/pdf/" in href_lower or href_lower.endswith(".pdf"):
        return "pdf"
    return "html"


def extract_sfy_html_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all(["script", "style", "noscript"]):
        tag.decompose()

    body = soup.body or soup
    text = body.get_text("\n", strip=True).replace("\r\n", "\n").replace("\r", "\n").strip()
    return text


def discover_sfy_movie_index(session: requests.Session, logger: logging.Logger) -> list[dict[str, Any]]:
    global SFY_MOVIE_INDEX
    if SFY_MOVIE_INDEX is not None:
        return SFY_MOVIE_INDEX

    logger.info("Building Screenplays for You movie index from %s", SFY_INDEX_URL)
    try:
        html = fetch_html(session, SFY_INDEX_URL)
    except requests.RequestException as error:
        raise LookupError(f"Screenplays for You could not be reached from the scraper runtime: {error}") from error

    soup = BeautifulSoup(html, "html.parser")
    discovered: dict[str, dict[str, Any]] = {}

    for anchor in soup.find_all("a", href=True):
        href = normalize_whitespace(anchor.get("href"))
        if not href:
            continue
        if not (
            href.startswith("/script/")
            or href.startswith("script/")
            or href.startswith("/pdf/")
            or href.startswith("pdf/")
            or href.startswith("/?script=")
            or href.startswith("?script=")
        ):
            continue

        raw_title = normalize_whitespace(anchor.get_text(" ", strip=True))
        if not raw_title:
            continue

        script_url = urljoin(SFY_BASE_URL, href)
        script_format = sfy_format_from_href(href)
        item = {
            "title": clean_sfy_title(raw_title) or raw_title,
            "raw_title": raw_title,
            "script_url": script_url,
            "script_format": script_format,
            "_format_bonus": format_preference_bonus(script_format),
        }

        existing = discovered.get(script_url)
        if existing and existing.get("_format_bonus", 0) >= item["_format_bonus"]:
            continue
        discovered[script_url] = item

    SFY_MOVIE_INDEX = sorted(discovered.values(), key=lambda item: normalize_title_for_match(item["title"]))
    logger.info("Built Screenplays for You movie index with %s title link(s)", len(SFY_MOVIE_INDEX))
    return SFY_MOVIE_INDEX


def discover_screenplaydb_movie_index(session: requests.Session, logger: logging.Logger) -> list[dict[str, Any]]:
    logger.info("Building ScreenplayDB movie index from %s", SCREENPLAYDB_FILM_ALL_URL)
    try:
        response = session.get(SCREENPLAYDB_FILM_ALL_URL, timeout=REQUEST_TIMEOUT_SECONDS, allow_redirects=True)
    except requests.exceptions.SSLError as error:
        raise LookupError(f"ScreenplayDB could not be reached over HTTPS because its TLS certificate is invalid or expired: {error}") from error
    except requests.RequestException as error:
        raise LookupError(f"ScreenplayDB could not be reached from the scraper runtime: {error}") from error

    html = response.text
    final_url = normalize_whitespace(response.url)
    if "account suspended" in html.lower() or "suspendedpage.cgi" in final_url.lower():
        raise LookupError("ScreenplayDB is currently suspended, so its film index cannot be fetched automatically.")

    raise LookupError("ScreenplayDB is reachable, but its current film index structure has not been mapped yet.")


def search_screenplaydb_movie_entry(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> dict[str, Any]:
    title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    logger.info("%s Searching ScreenplayDB for movie \"%s\"", log_prefix, title)
    discover_screenplaydb_movie_index(session, logger)
    raise LookupError(f"No ScreenplayDB movie match found for {title}")


def moviescriptsandscreenplays_format_from_href(href: str) -> str:
    href_lower = href.lower()
    if ".pdf" in href_lower or href_lower.endswith(".pdf"):
        return "pdf"
    if href_lower.endswith(".doc") or href_lower.endswith(".docx"):
        return "doc"
    if href_lower.endswith((".txt", ".text")):
        return "text"
    return "html"


def extract_moviescriptsandscreenplays_html_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all(["script", "style", "noscript"]):
        tag.decompose()

    pre = soup.find("pre")
    if pre:
        return pre.get_text("\n", strip=True).replace("\r\n", "\n").replace("\r", "\n").strip()

    body = soup.body or soup
    return body.get_text("\n", strip=True).replace("\r\n", "\n").replace("\r", "\n").strip()


def parse_moviescriptsandscreenplays_movie_entry(anchor: BeautifulSoup, index_url: str) -> dict[str, Any] | None:
    href = normalize_whitespace(anchor.get("href"))
    raw_title = normalize_whitespace(anchor.get_text(" ", strip=True))
    parent = anchor.parent

    if not href or not raw_title or getattr(parent, "name", None) != "b":
        return None
    if href.startswith(("javascript:", "#", "mailto:")):
        return None
    if raw_title.lower() in {
        "movie scripts a - f",
        "movie scripts g - o",
        "movie scripts p - z",
        "links",
        "host",
        "info",
    }:
        return None
    if any(domain in href.lower() for domain in ("imdb.com", "google.com", "simplyscripts.com", "download.com")):
        return None

    writer_text = ""
    draft_info = ""
    host_url = ""
    info_url = ""

    for sibling in parent.next_siblings:
        if getattr(sibling, "name", None) == "b":
            break

        if isinstance(sibling, str):
            text = normalize_whitespace(sibling)
            if not text:
                continue
            if not writer_text and re.match(r"^-\s*by\s+", text, flags=re.IGNORECASE):
                writer_text = re.sub(r"^-\s*by\s+", "", text, flags=re.IGNORECASE).strip()
                continue
            if not draft_info:
                draft_info = text
            continue

        if getattr(sibling, "find_all", None):
            for link in sibling.find_all("a", href=True):
                label = normalize_whitespace(link.get_text(" ", strip=True)).lower()
                resolved = urljoin(index_url, link.get("href"))
                if label == "host":
                    host_url = resolved
                elif label == "info":
                    info_url = resolved

    script_url = urljoin(index_url, href)
    script_format = moviescriptsandscreenplays_format_from_href(script_url)
    writers = parse_people_list(writer_text)
    return {
        "title": raw_title,
        "raw_title": raw_title,
        "script_url": script_url,
        "script_format": script_format,
        "writers": writers,
        "writer": ", ".join(writers),
        "draft_info": draft_info or None,
        "host_url": host_url or None,
        "info_url": info_url or None,
        "index_url": index_url,
        "_format_bonus": format_preference_bonus(script_format),
    }


def discover_moviescriptsandscreenplays_movie_index(
    session: requests.Session, logger: logging.Logger
) -> list[dict[str, Any]]:
    global MOVIE_SCRIPTS_AND_SCREENPLAYS_MOVIE_INDEX
    if MOVIE_SCRIPTS_AND_SCREENPLAYS_MOVIE_INDEX is not None:
        return MOVIE_SCRIPTS_AND_SCREENPLAYS_MOVIE_INDEX

    logger.info(
        "Building Movie Scripts and Screenplays movie index from %s page(s)",
        len(MOVIE_SCRIPTS_AND_SCREENPLAYS_INDEX_URLS),
    )
    discovered: dict[str, dict[str, Any]] = {}

    for index_url in MOVIE_SCRIPTS_AND_SCREENPLAYS_INDEX_URLS:
        soup = BeautifulSoup(fetch_html(session, index_url), "html.parser")
        page_count = 0
        for anchor in soup.find_all("a", href=True):
            item = parse_moviescriptsandscreenplays_movie_entry(anchor, index_url)
            if not item:
                continue

            existing = discovered.get(item["script_url"])
            if existing and existing.get("_format_bonus", 0) >= item["_format_bonus"]:
                continue

            discovered[item["script_url"]] = item
            page_count += 1

        logger.info("Collected %s Movie Scripts and Screenplays title link(s) from %s", page_count, index_url)

    MOVIE_SCRIPTS_AND_SCREENPLAYS_MOVIE_INDEX = sorted(
        discovered.values(), key=lambda item: normalize_title_for_match(item["title"])
    )
    logger.info(
        "Built Movie Scripts and Screenplays movie index with %s title link(s)",
        len(MOVIE_SCRIPTS_AND_SCREENPLAYS_MOVIE_INDEX),
    )
    return MOVIE_SCRIPTS_AND_SCREENPLAYS_MOVIE_INDEX


def search_moviescriptsandscreenplays_movie_entries(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> list[dict[str, Any]]:
    title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    year = catalog_movie.get("year") or catalog_movie.get("releaseDate")

    logger.info("%s Searching Movie Scripts and Screenplays for movie \"%s\"", log_prefix, title)
    candidates = discover_moviescriptsandscreenplays_movie_index(session, logger)
    matches = rank_match_candidates(candidates, "title", title, year, year_field="")
    if not matches:
        raise LookupError(f"No Movie Scripts and Screenplays movie match found for {title}")
    return matches


def extract_moviescriptsandscreenplays_text(
    session: requests.Session,
    entry: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> tuple[str, int | None, str]:
    script_url = entry["script_url"]
    title = normalize_whitespace(entry.get("title")) or "Untitled Movie"
    script_format = entry.get("script_format")
    logger.info("%s Movie Scripts and Screenplays source URL: %s", log_prefix, script_url)

    if script_format == "doc":
        raise LookupError(f"Movie Scripts and Screenplays matched {title}, but the available file is a .doc document.")

    try:
        response = session.get(script_url, timeout=PDF_TIMEOUT_SECONDS, allow_redirects=True)
    except requests.RequestException as error:
        raise LookupError(
            f"Movie Scripts and Screenplays matched {title}, but the linked host request failed: {error}"
        ) from error

    final_url = normalize_whitespace(response.url) or script_url
    content_type = (response.headers.get("content-type") or "").lower()
    content = response.content

    if response.status_code >= 400:
        raise LookupError(
            f"Movie Scripts and Screenplays matched {title}, but the linked host returned HTTP {response.status_code}."
        )

    if "application/msword" in content_type or "officedocument.wordprocessingml" in content_type:
        raise LookupError(f"Movie Scripts and Screenplays matched {title}, but the linked file is a Word document.")

    if content.startswith(b"%PDF") or "application/pdf" in content_type:
        script_text, page_count = extract_pdf_bytes_text(content, logger, log_prefix)
        if script_text:
            return script_text, page_count, final_url
        raise LookupError(f"Movie Scripts and Screenplays matched {title}, but no readable text was extracted from the PDF.")

    if content_type.startswith("text/plain") or (script_format == "text" and "html" not in content_type):
        script_text = response.text.replace("\r\n", "\n").replace("\r", "\n").strip()
        if len(script_text) >= 500:
            logger.info(
                "%s Extracted %s characters from Movie Scripts and Screenplays plain-text source",
                log_prefix,
                len(script_text),
            )
            return script_text, None, final_url
        raise LookupError(f"Movie Scripts and Screenplays matched {title}, but the linked text file was empty.")

    if content_type and "text/html" not in content_type:
        raise LookupError(
            f"Movie Scripts and Screenplays matched {title}, but the linked host returned unsupported content type {content_type}."
        )

    html = response.text
    text = extract_moviescriptsandscreenplays_html_text(html)
    if len(text) >= 1000 and (has_script_markers(text) or len(text) >= 20000):
        logger.info(
            "%s Extracted %s characters from Movie Scripts and Screenplays HTML source",
            log_prefix,
            len(text),
        )
        return text, None, final_url

    if "/lander" in final_url.lower():
        raise LookupError(
            f"Movie Scripts and Screenplays matched {title}, but the linked host redirected to a generic landing page instead of the script."
        )

    raise LookupError(
        f"Movie Scripts and Screenplays matched {title}, but the linked host did not expose readable script text."
    )


def search_sfy_movie_entries(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> list[dict[str, Any]]:
    title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    year = catalog_movie.get("year") or catalog_movie.get("releaseDate")

    logger.info("%s Searching Screenplays for You for movie \"%s\"", log_prefix, title)
    candidates = discover_sfy_movie_index(session, logger)
    matches = rank_match_candidates(candidates, "title", title, year, year_field="")
    if not matches:
        raise LookupError(f"No Screenplays for You movie match found for {title}")
    return matches


def extract_sfy_text(
    session: requests.Session,
    entry: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> tuple[str, int | None]:
    script_url = entry["script_url"]
    script_format = entry.get("script_format")
    logger.info("%s Screenplays for You source URL: %s", log_prefix, script_url)

    if script_format == "pdf":
        text, page_count = extract_pdf_text(session, script_url, logger, log_prefix)
        return text, page_count

    response = session.get(script_url, timeout=PDF_TIMEOUT_SECONDS)
    response.raise_for_status()
    content_type = (response.headers.get("content-type") or "").lower()
    if content_type.startswith("text/plain"):
        text = response.text.replace("\r\n", "\n").replace("\r", "\n").strip()
    else:
        text = extract_sfy_html_text(response.text)

    if len(text) < 1000:
        raise LookupError(f"Screenplays for You matched {entry.get('title')}, but the linked page did not expose readable script text.")

    logger.info("%s Extracted %s characters from Screenplays for You %s source", log_prefix, len(text), script_format)
    return text, None


def discover_blacklist_movie_index(session: requests.Session, logger: logging.Logger) -> list[dict[str, Any]]:
    global BLACKLIST_MOVIE_INDEX
    if BLACKLIST_MOVIE_INDEX is not None:
        return BLACKLIST_MOVIE_INDEX

    logger.info("Building Go Into The Story movie index from %s", BLACKLIST_SCRIPT_LINKS_URL)
    response = session.get(BLACKLIST_SCRIPT_LINKS_URL, timeout=REQUEST_TIMEOUT_SECONDS, allow_redirects=True)
    html = response.text
    if response.status_code == 403 and (is_cloudflare_challenge_page(html) or "cloudflare" in html.lower()):
        raise LookupError("Go Into The Story is currently protected by a Cloudflare challenge, so the script list cannot be fetched automatically.")
    response.raise_for_status()
    if is_cloudflare_challenge_page(html):
        raise LookupError("Go Into The Story is currently protected by a Cloudflare challenge, so the script list cannot be fetched automatically.")

    soup = BeautifulSoup(html, "html.parser")
    discovered: dict[str, dict[str, Any]] = {}
    excluded_domains = {
        "medium.com",
        "play.google.com",
        "unsplash.com",
        "speechify.com",
        "help.medium.com",
        "status.medium.com",
        "blog.medium.com",
        "scottdistillery.medium.com",
    }
    excluded_text = {
        "sitemap",
        "open in app",
        "sign up",
        "sign in",
        "get app",
        "write",
        "search",
        "listen",
        "share",
        "follow",
        "help",
        "status",
        "about",
        "careers",
        "press",
        "blog",
        "privacy",
        "rules",
        "terms",
        "text to speech",
        "go into the story",
        "scott myers",
    }

    for anchor in soup.find_all("a", href=True):
        title = normalize_whitespace(anchor.get_text(" ", strip=True))
        if not title or title.lower() in excluded_text:
            continue
        if len(title) <= 1 or title.lower().startswith("written by "):
            continue

        script_url = urljoin(BLACKLIST_BASE_URL, anchor["href"])
        if any(domain in script_url for domain in excluded_domains):
            continue
        if script_url.startswith(BLACKLIST_BASE_URL) and script_url.rstrip("/") == BLACKLIST_SCRIPT_LINKS_URL.rstrip("/"):
            continue

        discovered[script_url] = {
            "title": title,
            "script_url": script_url,
            "source_url": BLACKLIST_SCRIPT_LINKS_URL,
        }

    BLACKLIST_MOVIE_INDEX = sorted(discovered.values(), key=lambda item: normalize_title_for_match(item["title"]))
    logger.info("Built Go Into The Story movie index with %s title link(s)", len(BLACKLIST_MOVIE_INDEX))
    return BLACKLIST_MOVIE_INDEX


def search_blacklist_movie_entries(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> list[dict[str, Any]]:
    title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    year = catalog_movie.get("year") or catalog_movie.get("releaseDate")

    logger.info("%s Searching Go Into The Story for movie \"%s\"", log_prefix, title)
    candidates = discover_blacklist_movie_index(session, logger)
    matches = rank_match_candidates(candidates, "title", title, year)
    if not matches:
        raise LookupError(f"No Go Into The Story movie script match found for {title}")
    return matches


def blacklist_candidate_links_from_article(article_html: str, title_hint: str | None = None) -> list[str]:
    soup = BeautifulSoup(article_html, "html.parser")
    urls: list[str] = []
    hint_tokens = {token for token in normalize_title_for_match(title_hint).split() if len(token) > 2}

    def add_url(value: str | None):
        candidate = normalize_whitespace(value)
        if candidate and candidate not in urls:
            urls.append(candidate)

    for anchor in soup.find_all("a", href=True):
        href = anchor.get("href")
        if not href:
            continue
        full_url = urljoin(BLACKLIST_BASE_URL, href)
        href_lower = full_url.lower()
        text = normalize_whitespace(anchor.get_text(" ", strip=True)).lower()
        token_text = normalize_title_for_match(f"{text} {href_lower}")
        tokens = {token for token in token_text.split() if len(token) > 2}
        title_matches = not hint_tokens or bool(hint_tokens & tokens)
        looks_script_related = (
            "script" in text
            or "screenplay" in text
            or "download" in text
            or "read" in text
            or "script" in href_lower
            or "screenplay" in href_lower
            or "read-the-screenplay" in href_lower
            or "pdf" in href_lower
        )
        if (
            href_lower.endswith(".pdf")
            or href_lower.endswith(".txt")
            or title_matches and looks_script_related and "documentcloud" in href_lower
            or title_matches and looks_script_related and "cloudfront.net" in href_lower
            or title_matches and looks_script_related and "deadline.com" in href_lower
            or title_matches and looks_script_related and "screenplay" in href_lower
            or title_matches and looks_script_related and "script" in href_lower
        ):
            add_url(full_url)

    return urls


def extract_blacklist_script_text(
    session: requests.Session,
    entry: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> tuple[str, int | None, str]:
    pending_urls = [normalize_whitespace(entry.get("script_url"))]
    seen_urls: set[str] = set()
    last_reason = "Go Into The Story did not expose a readable script file"

    while pending_urls:
        url = pending_urls.pop(0)
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)

        logger.info("%s Attempting Go Into The Story script URL: %s", log_prefix, url)
        try:
            response = session.get(url, timeout=PDF_TIMEOUT_SECONDS, allow_redirects=True)
        except requests.RequestException as error:
            last_reason = f"Go Into The Story request failed for {url}: {error}"
            continue

        final_url = normalize_whitespace(response.url) or url
        content_type = (response.headers.get("content-type") or "").lower()
        content = response.content

        if response.status_code >= 400:
            last_reason = f"Go Into The Story returned HTTP {response.status_code} for {final_url}"
            continue

        if content.startswith(b"%PDF") or "application/pdf" in content_type:
            script_text, page_count = extract_pdf_bytes_text(content, logger, log_prefix)
            if script_text:
                return script_text, page_count, final_url
            last_reason = "Go Into The Story matched a PDF, but no readable text was extracted"
            continue

        if content_type.startswith("text/plain"):
            script_text = response.text.replace("\r\n", "\n").replace("\r", "\n").strip()
            if script_text:
                logger.info("%s Extracted %s characters from Go Into The Story plain-text source", log_prefix, len(script_text))
                return script_text, None, final_url
            last_reason = "Go Into The Story matched a text file, but it was empty"
            continue

        if "text/html" not in content_type:
            last_reason = f"Go Into The Story returned unsupported content type {content_type or 'unknown'}"
            continue

        html = response.text
        if is_cloudflare_challenge_page(html):
            last_reason = "Go Into The Story is currently protected by a Cloudflare challenge, so the linked page cannot be read automatically"
            continue

        soup = BeautifulSoup(html, "html.parser")
        text = soup.get_text("\n", strip=True).replace("\r\n", "\n").replace("\r", "\n").strip()
        final_url_lower = final_url.lower()

        if len(text) >= 20000 and has_script_markers(text):
            logger.info("%s Extracted %s characters from Go Into The Story HTML source", log_prefix, len(text))
            return text, None, final_url

        if any(domain in final_url_lower for domain in ("deadline.com", "indiewire.com", "blcklst.com", "medium.com")):
            for candidate_url in blacklist_candidate_links_from_article(html, entry.get("title")):
                if candidate_url not in seen_urls:
                    pending_urls.append(candidate_url)
            last_reason = "Go Into The Story article listed the script, but the linked script file was not publicly readable"
            continue

        last_reason = "Go Into The Story matched a page, but it did not expose readable script text"

    raise LookupError(last_reason + ".")


def parse_studio_binder_entry_identity(raw_title: str) -> dict[str, Any]:
    title = normalize_whitespace(raw_title)
    season_number = None
    episode_number = None
    episode_title = None
    show_name = title

    code_match = re.search(r"\(\s*S(\d+)\s*E(\d+)\s*\)\s*$", title, flags=re.IGNORECASE)
    if not code_match:
        code_match = re.search(r"\bS(\d+)\s*E(\d+)\s*$", title, flags=re.IGNORECASE)
    if code_match:
        season_number = int(code_match.group(1))
        episode_number = int(code_match.group(2))
        title = normalize_whitespace(title[: code_match.start()])

    if " - " in title:
        show_name, episode_title = [normalize_whitespace(part) for part in title.split(" - ", 1)]
    else:
        paren_match = re.search(r"\(([^)]*)\)\s*$", title)
        if paren_match:
            parenthetical = normalize_whitespace(paren_match.group(1))
            base_title = normalize_whitespace(title[: paren_match.start()])
            if parenthetical:
                show_name = base_title or title
                episode_title = parenthetical

    show_name = show_name or raw_title
    if not episode_title and (season_number is not None or episode_number is not None):
        episode_title = normalize_whitespace(raw_title)

    return {
        "show_name": show_name,
        "episode_title": episode_title,
        "season_number": season_number,
        "episode_number": episode_number,
    }


def discover_studio_binder_tv_index(session: requests.Session, logger: logging.Logger) -> list[dict[str, Any]]:
    global STUDIOBINDER_TV_INDEX
    if STUDIOBINDER_TV_INDEX is not None:
        return STUDIOBINDER_TV_INDEX

    logger.info("Building StudioBinder TV index from %s", STUDIOBINDER_TV_SCRIPTS_URL)
    soup = BeautifulSoup(fetch_html(session, STUDIOBINDER_TV_SCRIPTS_URL), "html.parser")
    discovered: list[dict[str, Any]] = []

    for section in soup.select("div.thrv_wrapper.thrv-page-section"):
        h3 = section.find("h3")
        if not h3:
            continue

        raw_title = normalize_whitespace(h3.get_text(" ", strip=True))
        if not raw_title:
            continue

        title_link = h3.find("a", href=True)
        title_url = urljoin(STUDIOBINDER_BASE_URL, title_link["href"]) if title_link else ""
        view_link = next(
            (
                anchor
                for anchor in section.find_all("a", href=True)
                if "view script" in normalize_whitespace(anchor.get_text(" ", strip=True)).lower()
            ),
            None,
        )
        view_script_url = urljoin(STUDIOBINDER_BASE_URL, view_link["href"]) if view_link else title_url

        writers_text = ""
        synopsis = None
        for paragraph in section.find_all("p"):
            text = normalize_whitespace(paragraph.get_text(" ", strip=True))
            if not text:
                continue
            if text.lower().startswith("written by"):
                writers_text = normalize_whitespace(re.sub(r"^Written By:\s*", "", text, flags=re.IGNORECASE))
            elif text.lower().startswith("synopsis"):
                synopsis = normalize_whitespace(re.sub(r"^Synopsis\s*:?\s*", "", text, flags=re.IGNORECASE))

        genres_heading = section.find("h2")
        identity = parse_studio_binder_entry_identity(raw_title)
        discovered.append(
            {
                "title": raw_title,
                "show_name": identity["show_name"],
                "episode_title": identity["episode_title"],
                "season_number": identity["season_number"],
                "episode_number": identity["episode_number"],
                "writers": parse_people_list(writers_text),
                "writer": writers_text,
                "synopsis": synopsis,
                "genres": normalize_whitespace(genres_heading.get_text(" ", strip=True)) if genres_heading else None,
                "title_url": title_url,
                "view_script_url": view_script_url,
                "source_url": STUDIOBINDER_TV_SCRIPTS_URL,
            }
        )

    STUDIOBINDER_TV_INDEX = discovered
    logger.info("Built StudioBinder TV index with %s entry(s)", len(STUDIOBINDER_TV_INDEX))
    return STUDIOBINDER_TV_INDEX


def search_studio_binder_tv_entries(
    session: requests.Session,
    catalog_show: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> list[dict[str, Any]]:
    title = normalize_whitespace(catalog_show.get("title")) or "Untitled Show"
    year = catalog_show.get("year") or catalog_show.get("releaseDate")
    target_norm = normalize_title_for_match(title)

    logger.info("%s Searching StudioBinder for TV show \"%s\"", log_prefix, title)
    candidates = discover_studio_binder_tv_index(session, logger)
    matches = [
        candidate
        for candidate in candidates
        if (
            is_plausible_title_match(candidate.get("show_name"), None, title, year)
            or target_norm in normalize_title_for_match(candidate.get("show_name"))
        )
    ]
    matches.sort(
        key=lambda candidate: (
            -match_score(candidate.get("show_name"), None, title, year),
            candidate.get("season_number") if candidate.get("season_number") is not None else 9999,
            candidate.get("episode_number") if candidate.get("episode_number") is not None else 9999,
            normalize_title_for_match(candidate.get("episode_title") or candidate.get("title")),
        )
    )
    if not matches:
        raise LookupError(f"No StudioBinder TV script match found for {title}")
    return matches


def studio_binder_candidate_links_from_article(article_html: str, title_hint: str | None = None) -> list[str]:
    soup = BeautifulSoup(article_html, "html.parser")
    urls: list[str] = []
    hint_tokens = {token for token in normalize_title_for_match(title_hint).split() if len(token) > 2}

    def add_url(value: str | None):
        candidate = normalize_whitespace(value)
        if candidate and candidate not in urls:
            urls.append(candidate)

    for anchor in soup.find_all("a", href=True):
        href = urljoin(STUDIOBINDER_BASE_URL, anchor["href"])
        text = normalize_whitespace(anchor.get_text(" ", strip=True)).lower()
        href_lower = href.lower()
        combined_text = normalize_title_for_match(f"{text} {href_lower}")
        combined_tokens = {token for token in combined_text.split() if len(token) > 2}
        looks_script_related = (
            "read full script" in text
            or "view script" in text
            or "full script" in text
            or "script pdf" in text
            or "utm_campaign=script" in href_lower
            or "full-script" in href_lower
            or "script-pdf" in href_lower
            or "pdf-download" in href_lower
        )
        title_matches = not hint_tokens or bool(hint_tokens & combined_tokens)
        if (
            href_lower.endswith(".pdf")
            or title_matches and looks_script_related and "bit.ly" in href_lower
            or title_matches and looks_script_related and "app.studiobinder.com/company/" in href_lower
            or title_matches and looks_script_related and "app.studiobinder.com/shared/" in href_lower
        ):
            add_url(href)

    return urls


def extract_studio_binder_script_text(
    session: requests.Session,
    entry: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> tuple[str, int | None, str]:
    pending_urls = [
        normalize_whitespace(entry.get("view_script_url")),
        normalize_whitespace(entry.get("title_url")),
    ]
    seen_urls: set[str] = set()
    last_reason = "StudioBinder did not expose a readable script file"

    while pending_urls:
        url = pending_urls.pop(0)
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)

        logger.info("%s Attempting StudioBinder script URL: %s", log_prefix, url)
        try:
            response = session.get(url, timeout=PDF_TIMEOUT_SECONDS, allow_redirects=True)
        except requests.RequestException as error:
            last_reason = f"StudioBinder request failed for {url}: {error}"
            continue

        final_url = normalize_whitespace(response.url) or url
        content_type = (response.headers.get("content-type") or "").lower()
        content = response.content

        if response.status_code >= 400:
            last_reason = f"StudioBinder returned HTTP {response.status_code} for {final_url}"
            continue

        if content.startswith(b"%PDF") or "application/pdf" in content_type:
            script_text, page_count = extract_pdf_bytes_text(content, logger, log_prefix)
            if script_text:
                return script_text, page_count, final_url
            last_reason = "StudioBinder matched a PDF, but no readable text was extracted"
            continue

        if content_type.startswith("text/plain"):
            script_text = response.text.replace("\r\n", "\n").replace("\r", "\n").strip()
            if script_text:
                logger.info("%s Extracted %s characters from StudioBinder plain-text source", log_prefix, len(script_text))
                return script_text, None, final_url
            last_reason = "StudioBinder matched a text file, but it was empty"
            continue

        if "text/html" not in content_type:
            last_reason = f"StudioBinder returned unsupported content type {content_type or 'unknown'}"
            continue

        html = response.text
        soup = BeautifulSoup(html, "html.parser")
        page_title = normalize_whitespace(soup.title.get_text(" ", strip=True) if soup.title else "")
        text = soup.get_text("\n", strip=True).replace("\r\n", "\n").replace("\r", "\n").strip()

        if "app.studiobinder.com" in final_url and "studiobinder app" in page_title.lower():
            last_reason = "StudioBinder linked to the app viewer, but no public script text was embedded in the HTML"
            continue

        if "www.studiobinder.com/blog/" in final_url:
            for candidate_url in studio_binder_candidate_links_from_article(html, entry.get("show_name") or entry.get("title")):
                if candidate_url not in seen_urls:
                    pending_urls.append(candidate_url)
            last_reason = "StudioBinder article listed the script, but the linked script file was not publicly readable"
            continue

        if len(text) >= 20000 and has_script_markers(text):
            logger.info("%s Extracted %s characters from StudioBinder HTML source", log_prefix, len(text))
            return text, None, final_url

        last_reason = "StudioBinder matched a page, but it did not expose readable script text"

    raise LookupError(last_reason + ".")


def iter_tv_episode_nodes(soup: BeautifulSoup) -> Iterable[tuple[str | None, object]]:
    heading = soup.find("h1")
    current_series = None

    if not heading:
        return

    for node in heading.find_all_next(["h2", "p"]):
        if node.name == "h2":
            current_series = normalize_whitespace(node.get_text(" ", strip=True))
            continue

        if node.name == "p":
            yield current_series, node


def parse_people_list(value: str) -> list[str]:
    if not value:
        return []

    normalized = re.sub(r"^\s*(written by|by)\s*", "", value, flags=re.IGNORECASE).strip()
    if not normalized:
        return []

    parts = re.split(r"\s*(?:,|&| and )\s*", normalized)
    return [part.strip() for part in parts if part.strip()]


def extract_tv_episode_records(show_html: str, show_url: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(show_html, "html.parser")
    records: list[dict[str, Any]] = []

    for current_series, node in iter_tv_episode_nodes(soup):
        link = node.find("a", href=True)
        if not link:
            continue

        href = link["href"].strip()
        if not href.startswith("/TV Transcripts/"):
            continue

        title = normalize_whitespace(link.get_text(" ", strip=True))
        raw_text = normalize_whitespace(node.get_text(" ", strip=True))
        air_date_match = re.search(r"\((\d{4}-\d{2}-\d{2})\)", raw_text)
        italic = node.find("i")
        writers = parse_people_list(italic.get_text(" ", strip=True) if italic else "")

        records.append(
            {
                "series": current_series,
                "episode_title": title,
                "air_date": air_date_match.group(1) if air_date_match else None,
                "writers": writers,
                "writer": ", ".join(writers),
                "metadata_url": urljoin(IMSDB_BASE_URL, href),
                "show_url": show_url,
            }
        )

    return records


def discover_show_episodes(
    session: requests.Session,
    logger: logging.Logger,
    show_id: str,
    show_name: str,
    episode_limit: int | None = None,
) -> list[dict[str, Any]]:
    episodes = paginate_graphql_entries(
        session=session,
        logger=logger,
        label=f"TV episode discovery for {show_name}",
        query=SHOW_EPISODES_QUERY,
        field_name="scriptsEntries",
        variables={"relationId": [show_id]},
        total_limit=episode_limit,
    )
    episodes.sort(
        key=lambda item: (
            int(item.get("seasonNumber") or 0),
            int(item.get("episodeNumber") or 0),
            normalize_whitespace(item.get("episodeTitle")).lower(),
            normalize_whitespace(item.get("year")).lower(),
        )
    )
    return episodes


def extract_pdf_text(session: requests.Session, pdf_url: str, logger: logging.Logger, log_prefix: str) -> tuple[str, int]:
    logger.info("%s Downloading PDF from %s", log_prefix, pdf_url)
    response = session.get(pdf_url, timeout=PDF_TIMEOUT_SECONDS)
    response.raise_for_status()

    return extract_pdf_bytes_text(response.content, logger, log_prefix)


def extract_pdf_bytes_text(pdf_bytes: bytes, logger: logging.Logger, log_prefix: str) -> tuple[str, int]:
    logger.info("%s PDF download complete (%s bytes)", log_prefix, len(pdf_bytes))
    reader = PdfReader(BytesIO(pdf_bytes))
    page_count = len(reader.pages)
    logger.info("%s Extracting text from %s PDF page(s)", log_prefix, page_count)

    page_text: list[str] = []
    for page in reader.pages:
        text = (page.extract_text() or "").replace("\r\n", "\n").replace("\r", "\n").strip()
        if text:
            page_text.append(text)

    script_text = "\n\n".join(page_text).strip()
    logger.info("%s Extracted %s characters of script text", log_prefix, len(script_text))
    return script_text, page_count


def download_script_hive_text(
    session: requests.Session,
    row: dict[str, Any],
    logger: logging.Logger,
    log_prefix: str,
) -> tuple[str, int | None, str | None]:
    file_id = normalize_whitespace(row.get("Id"))
    source_url = normalize_whitespace(row.get("URL"))
    urls_to_try: list[str] = []

    def add_url(value: str | None):
        candidate = normalize_whitespace(value)
        if candidate and candidate not in urls_to_try:
            urls_to_try.append(candidate)

    add_url(source_url)
    if file_id:
        add_url(f"https://drive.google.com/uc?export=download&id={file_id}")
        add_url(f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t")

    last_issue = "no public file URL was provided"
    for url in urls_to_try:
        logger.info("%s Attempting ScriptHive file download from %s", log_prefix, url)
        response = session.get(url, timeout=PDF_TIMEOUT_SECONDS, allow_redirects=True)
        final_url = normalize_whitespace(response.url)
        content_type = (response.headers.get("content-type") or "").lower()

        if response.status_code >= 400:
            last_issue = f"HTTP {response.status_code} from {url}"
            continue

        if "accounts.google.com" in final_url or "service=wise" in final_url:
            last_issue = "Google Drive required sign-in for the matched file"
            continue

        content = response.content
        if content.startswith(b"%PDF") or "application/pdf" in content_type:
            script_text, page_count = extract_pdf_bytes_text(content, logger, log_prefix)
            if script_text:
                return script_text, page_count, final_url or url
            last_issue = "the matched PDF downloaded but no readable text was extracted"
            continue

        if content_type.startswith("text/plain"):
            script_text = response.text.replace("\r\n", "\n").replace("\r", "\n").strip()
            if script_text:
                logger.info("%s Extracted %s characters of plain-text script text", log_prefix, len(script_text))
                return script_text, None, final_url or url
            last_issue = "the matched text file was empty"
            continue

        if "text/html" in content_type:
            soup = BeautifulSoup(response.text, "html.parser")
            text = soup.get_text("\n", strip=True).replace("\r\n", "\n").replace("\r", "\n").strip()
            if "sign in" in text.lower() and "google" in text.lower():
                last_issue = "Google Drive required sign-in for the matched file"
                continue
            if len(text) >= 20000 and any(marker in text.upper() for marker in ("FADE IN", "INT.", "EXT.", "CUT TO")):
                logger.info("%s Extracted %s characters of HTML script text", log_prefix, len(text))
                return text, None, final_url or url
            last_issue = "the matched file resolved to HTML instead of a readable script document"
            continue

        last_issue = f"unsupported content type {content_type or 'unknown'}"

    raise LookupError(f"ScriptHive matched a file, but {last_issue}.")


def script_hive_writers(row: dict[str, Any]) -> list[str]:
    return parse_people_list(normalize_whitespace(row.get("Writer(s)")))


def script_hive_source_url(row: dict[str, Any], resolved_url: str | None = None) -> str:
    return resolved_url or normalize_whitespace(row.get("URL")) or SCRIPT_HIVE_BASE_URL


def script_hive_display_title(row: dict[str, Any], fallback: str) -> str:
    return normalize_whitespace(row.get("Script Title")) or cleaned_script_hive_title(row) or fallback


def script_hive_file_type(row: dict[str, Any]) -> str | None:
    return normalize_whitespace(row.get("Type")) or None


def script_hive_draft_date(row: dict[str, Any]) -> str | None:
    return normalize_whitespace(row.get("Draft Date")) or None


def script_hive_document_type(row: dict[str, Any]) -> str | None:
    return normalize_whitespace(row.get("Document Type")) or None


def script_hive_folder(row: dict[str, Any]) -> str | None:
    return normalize_whitespace(row.get("Folder")) or None


def script_hive_alternate_titles(row: dict[str, Any]) -> str | None:
    return normalize_whitespace(row.get("Alternate Titles")) or None


def script_hive_episode_code(row: dict[str, Any]) -> str | None:
    return normalize_whitespace(row.get("Episode #")) or None


def script_hive_category(row: dict[str, Any]) -> str | None:
    return normalize_whitespace(row.get("Category")) or None


def script_hive_file_id(row: dict[str, Any]) -> str | None:
    return normalize_whitespace(row.get("file_id")) or None


def script_hive_google_drive_id(row: dict[str, Any]) -> str | None:
    return normalize_whitespace(row.get("Id")) or None


def save_json(path: Path, payload: dict[str, Any]):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def build_movie_not_found_payload(
    catalog_movie: dict[str, Any],
    reason: str,
    sources_checked: list[str] | None = None,
) -> dict[str, Any]:
    title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    catalog_year = extract_year(catalog_movie.get("year") or catalog_movie.get("releaseDate"))
    return {
        "media_type": "movie",
        "source_site": ", ".join(sources_checked or MOVIE_FALLBACK_SOURCES),
        "sources_checked": sources_checked or MOVIE_FALLBACK_SOURCES,
        "catalog_source": catalog_movie.get("source"),
        "catalog_source_key": catalog_movie.get("sourceKey"),
        "catalog_path": catalog_movie.get("_catalog_path"),
        "catalog_line": catalog_movie.get("_catalog_line"),
        "catalog_title": title,
        "catalog_year": catalog_year,
        "title": title,
        "year": catalog_year,
        "script_found": False,
        "status": "script_not_found",
        "reason": reason,
        "writers": [],
        "writer": "",
        "synopsis": strip_html(catalog_movie.get("synopsis") or catalog_movie.get("overview")),
        "script": "script not found",
        "script_text": "script not found",
    }


def build_tv_not_found_payload(
    catalog_show: dict[str, Any],
    reason: str,
    sources_checked: list[str] | None = None,
) -> dict[str, Any]:
    title = normalize_whitespace(catalog_show.get("title")) or "Untitled Show"
    catalog_year = extract_year(catalog_show.get("year") or catalog_show.get("releaseDate"))
    return {
        "media_type": "tv_show",
        "source_site": ", ".join(sources_checked or TV_FALLBACK_SOURCES),
        "sources_checked": sources_checked or TV_FALLBACK_SOURCES,
        "catalog_source": catalog_show.get("source"),
        "catalog_source_key": catalog_show.get("sourceKey"),
        "catalog_path": catalog_show.get("_catalog_path"),
        "catalog_line": catalog_show.get("_catalog_line"),
        "catalog_title": title,
        "catalog_year": catalog_year,
        "show_name": title,
        "series": title,
        "year": catalog_year,
        "script_found": False,
        "status": "script_not_found",
        "reason": reason,
        "writers": [],
        "writer": "",
        "synopsis": strip_html(catalog_show.get("synopsis") or catalog_show.get("overview")),
        "script": "script not found",
        "script_text": "script not found",
    }


def build_missing_script_summary_entry(payload: dict[str, Any], output_path: Path, output_root: Path) -> dict[str, Any]:
    return {
        "media_type": payload.get("media_type"),
        "title": payload.get("title") or payload.get("show_name") or payload.get("catalog_title"),
        "show_name": payload.get("show_name"),
        "year": payload.get("year"),
        "catalog_title": payload.get("catalog_title"),
        "catalog_year": payload.get("catalog_year"),
        "reason": payload.get("reason"),
        "status": payload.get("status"),
        "sources_checked": payload.get("sources_checked") or [],
        "catalog_source": payload.get("catalog_source"),
        "catalog_source_key": payload.get("catalog_source_key"),
        "catalog_path": payload.get("catalog_path"),
        "catalog_line": payload.get("catalog_line"),
        "output_path": output_path.relative_to(output_root).as_posix(),
    }


def save_missing_scripts_summary(
    output_root: Path,
    logger: logging.Logger,
    movie_entries: list[dict[str, Any]],
    tv_entries: list[dict[str, Any]],
):
    output_path = output_root / "missing_scripts.json"
    payload = {
        "status": "ok",
        "summary_type": "missing_scripts",
        "total_missing": len(movie_entries) + len(tv_entries),
        "movie_count": len(movie_entries),
        "tv_show_count": len(tv_entries),
        "movies": movie_entries,
        "tv_shows": tv_entries,
    }
    save_json(output_path, payload)
    logger.info(
        "Saved missing script summary with %s movie(s) and %s TV show(s) -> %s",
        len(movie_entries),
        len(tv_entries),
        output_path,
    )


def save_missing_movies_summary(output_root: Path, logger: logging.Logger, movie_entries: list[dict[str, Any]]):
    output_path = output_root / "missing_movies.json"
    payload = {
        "status": "ok",
        "summary_type": "missing_movies",
        "movie_count": len(movie_entries),
        "movies": movie_entries,
    }
    save_json(output_path, payload)
    logger.info("Saved missing movie summary with %s movie(s) -> %s", len(movie_entries), output_path)


def save_movie_not_found(
    catalog_movie: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    reason: str,
    log_prefix: str,
    sources_checked: list[str] | None = None,
):
    title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    output_path = output_root / "movies" / f"{sanitize_path_part(title, 'movie')}.json"
    payload = build_movie_not_found_payload(catalog_movie, reason, sources_checked)

    save_json(output_path, payload)
    logger.info("%s Saved script-not-found placeholder for %s -> %s", log_prefix, title, output_path)


def save_tv_not_found(
    catalog_show: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    reason: str,
    log_prefix: str,
    sources_checked: list[str] | None = None,
):
    title = normalize_whitespace(catalog_show.get("title")) or "Untitled Show"
    show_dir = output_root / "tv_shows" / sanitize_path_part(title, "tv_show")
    output_path = show_dir / "script_not_found.json"
    payload = build_tv_not_found_payload(catalog_show, reason, sources_checked)

    save_json(output_path, payload)
    logger.info("%s Saved script-not-found placeholder for %s -> %s", log_prefix, title, output_path)


def unique_episode_path(show_dir: Path, episode_title: str, season_number: int | None, episode_number: int | None) -> Path:
    base_name = sanitize_path_part(episode_title, "episode")
    path = show_dir / f"{base_name}.json"
    if not path.exists():
        return path

    try:
        existing_payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        existing_payload = None

    if existing_payload:
        same_season = existing_payload.get("season_number") == season_number
        same_episode = existing_payload.get("episode_number") == episode_number
        same_title = normalize_whitespace(existing_payload.get("episode_title")) == episode_title
        if same_season and same_episode and same_title:
            return path

    suffix_bits = []
    if season_number is not None:
        suffix_bits.append(f"S{season_number:02d}")
    if episode_number is not None:
        suffix_bits.append(f"E{episode_number:02d}")
    suffix = "".join(suffix_bits) or "duplicate"
    return show_dir / f"{base_name} ({suffix}).json"


def scrape_movie_from_script_slug(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    index: int,
    total: int,
):
    catalog_title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    catalog_year = extract_year(catalog_movie.get("year") or catalog_movie.get("releaseDate"))
    log_prefix = f"[Movie {index}/{total}]"

    logger.info(
        "%s Catalog entry: %s (%s) from %s:%s",
        log_prefix,
        catalog_title,
        str(catalog_year or "?"),
        catalog_movie.get("_catalog_path"),
        catalog_movie.get("_catalog_line"),
    )

    movie, search_term = search_movie_entry(session, catalog_movie, logger, log_prefix)
    title = normalize_whitespace(movie.get("scriptTitle")) or catalog_title
    page_url = movie.get("url") or ""
    pdf_asset = script_asset(movie)
    writers = writer_names(movie)

    logger.info("%s Matched online movie script with search term \"%s\": %s", log_prefix, search_term, page_url)
    logger.info("%s Writers: %s", log_prefix, ", ".join(writers) if writers else "Unknown")

    if movie.get("comingSoon"):
        raise ValueError(f"Script marked as coming soon for movie: {title}")
    if not pdf_asset:
        raise ValueError(f"Could not find a PDF asset for movie: {title}")

    pdf_url = pdf_asset["url"]
    script_text, page_count = extract_pdf_text(session, pdf_url, logger, log_prefix)
    if not script_text:
        raise ValueError(f"Extracted empty script text for movie: {title}")

    payload = {
        "media_type": "movie",
        "source_site": "Script Slug",
        "sources_checked": ["Script Slug"],
        "catalog_source": catalog_movie.get("source"),
        "catalog_source_key": catalog_movie.get("sourceKey"),
        "catalog_path": catalog_movie.get("_catalog_path"),
        "catalog_line": catalog_movie.get("_catalog_line"),
        "catalog_title": catalog_title,
        "catalog_year": catalog_year,
        "title": title,
        "year": movie.get("year"),
        "writers": writers,
        "writer": ", ".join(writers),
        "synopsis": strip_html(movie.get("synopsis")),
        "source_url": page_url,
        "page_url": page_url,
        "script_slug_uri": movie.get("uri"),
        "pdf_url": pdf_url,
        "pdf_filename": pdf_asset.get("filename"),
        "pdf_title": pdf_asset.get("title"),
        "pdf_page_count": page_count,
        "script": script_text,
        "script_text": script_text,
    }

    output_path = output_root / "movies" / f"{sanitize_path_part(title, 'movie')}.json"
    save_json(output_path, payload)
    logger.info("%s Saved %s -> %s", log_prefix, title, output_path)


def scrape_movie_from_imsdb(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    index: int,
    total: int,
):
    catalog_title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    catalog_year = extract_year(catalog_movie.get("year") or catalog_movie.get("releaseDate"))
    log_prefix = f"[Movie {index}/{total}]"

    movie = search_imsdb_movie_entry(session, catalog_movie, logger, log_prefix)
    metadata_url = movie["metadata_url"]
    metadata_html = fetch_html(session, metadata_url)
    metadata_soup = BeautifulSoup(metadata_html, "html.parser")
    read_url = extract_read_link(metadata_soup)
    if not read_url:
        raise LookupError(f"IMSDb matched {catalog_title} but no readable script page was linked.")

    writers = extract_sidebar_writers(metadata_soup)
    logger.info("%s IMSDb matched movie page: %s", log_prefix, metadata_url)
    logger.info("%s Writers: %s", log_prefix, ", ".join(writers) if writers else "Unknown")

    script_html = fetch_html(session, read_url, timeout=PDF_TIMEOUT_SECONDS)
    script_text = extract_script_text_from_read_page(script_html)
    if not script_text:
        raise ValueError(f"IMSDb script page was empty for movie: {catalog_title}")

    title = normalize_whitespace(movie.get("title")) or catalog_title
    payload = {
        "media_type": "movie",
        "source_site": "IMSDb",
        "sources_checked": ["Script Slug", "IMSDb"],
        "catalog_source": catalog_movie.get("source"),
        "catalog_source_key": catalog_movie.get("sourceKey"),
        "catalog_path": catalog_movie.get("_catalog_path"),
        "catalog_line": catalog_movie.get("_catalog_line"),
        "catalog_title": catalog_title,
        "catalog_year": catalog_year,
        "title": title,
        "year": catalog_year,
        "writers": writers,
        "writer": ", ".join(writers),
        "synopsis": strip_html(catalog_movie.get("synopsis") or catalog_movie.get("overview")),
        "page_url": metadata_url,
        "source_url": read_url,
        "imsdb_metadata_url": metadata_url,
        "imsdb_read_url": read_url,
        "script_date": extract_movie_script_date(metadata_soup),
        "script": script_text,
        "script_text": script_text,
    }

    output_path = output_root / "movies" / f"{sanitize_path_part(title, 'movie')}.json"
    save_json(output_path, payload)
    logger.info("%s Saved %s from IMSDb -> %s", log_prefix, title, output_path)


def scrape_movie_from_8flix(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    index: int,
    total: int,
):
    catalog_title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    catalog_year = extract_year(catalog_movie.get("year") or catalog_movie.get("releaseDate"))
    log_prefix = f"[Movie {index}/{total}]"
    pages = search_8flix_entries(
        session,
        catalog_title,
        catalog_year,
        logger,
        log_prefix,
        (EIGHTFLIX_FILM_PREFIX,),
    )
    if not pages:
        raise LookupError(f"No 8FLiX movie page match found for {catalog_title}")

    last_reason = ""
    for page in pages:
        payload = fetch_8flix_page_payload(session, page)
        content_html = ((payload.get("content") or {}).get("rendered")) or ""
        soup = BeautifulSoup(content_html, "html.parser")
        details = table_rows_to_dict(soup.find("table"))
        writers = parse_people_list(
            details.get("Screenplay") or details.get("Written by") or details.get("Writer") or ""
        )
        logger.info("%s 8FLiX matched movie page: %s", log_prefix, page["url"])
        logger.info("%s Writers: %s", log_prefix, ", ".join(writers) if writers else "Unknown")

        script_text = maybe_extract_8flix_public_script_text(content_html)
        if not script_text:
            last_reason = f"8FLiX page exists for {catalog_title}, but no public full script text was exposed."
            continue

        title = normalize_whitespace(unescape((payload.get("title") or {}).get("rendered"))) or catalog_title
        page_count = details.get("Pages")
        output = {
            "media_type": "movie",
            "source_site": "8FLiX",
            "sources_checked": ["Script Slug", "IMSDb", "8FLiX"],
            "catalog_source": catalog_movie.get("source"),
            "catalog_source_key": catalog_movie.get("sourceKey"),
            "catalog_path": catalog_movie.get("_catalog_path"),
            "catalog_line": catalog_movie.get("_catalog_line"),
            "catalog_title": catalog_title,
            "catalog_year": catalog_year,
            "title": title,
            "year": catalog_year,
            "writers": writers,
            "writer": ", ".join(writers),
            "synopsis": extract_8flix_logline(soup) or strip_html(catalog_movie.get("synopsis") or catalog_movie.get("overview")),
            "page_url": page["url"],
            "source_url": page["url"],
            "eightflix_page_id": payload.get("id"),
            "script_type": details.get("Type"),
            "script_version": details.get("Version"),
            "script_date": details.get("Date"),
            "page_count": page_count,
            "script": script_text,
            "script_text": script_text,
        }

        output_path = output_root / "movies" / f"{sanitize_path_part(title, 'movie')}.json"
        save_json(output_path, output)
        logger.info("%s Saved %s from 8FLiX -> %s", log_prefix, title, output_path)
        return

    raise LookupError(last_reason or f"8FLiX did not expose a readable movie script for {catalog_title}")


def scrape_movie_from_subslikescript(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    index: int,
    total: int,
):
    catalog_title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    catalog_year = extract_year(catalog_movie.get("year") or catalog_movie.get("releaseDate"))
    log_prefix = f"[Movie {index}/{total}]"
    pages = search_subslikescript_entries(
        session,
        catalog_title,
        catalog_year,
        logger,
        log_prefix,
        (SUBSLIKESCRIPT_MOVIE_PREFIX,),
    )
    if not pages:
        raise LookupError(f"No Subs like Script movie match found for {catalog_title}")

    last_reason = ""
    for page in pages:
        logger.info("%s Subs like Script matched movie page: %s", log_prefix, page["url"])
        soup = BeautifulSoup(fetch_html(session, page["url"]), "html.parser")
        heading = extract_subslikescript_heading(soup)
        script_text = extract_subslikescript_script_text(soup)
        if not script_text:
            last_reason = f"Subs like Script matched {catalog_title}, but the transcript text was empty."
            continue

        title = extract_subslikescript_movie_title(heading, catalog_title)
        payload = {
            "media_type": "movie",
            "source_site": "Subs like Script",
            "sources_checked": ["Script Slug", "IMSDb", "8FLiX", "Subs like Script"],
            "catalog_source": catalog_movie.get("source"),
            "catalog_source_key": catalog_movie.get("sourceKey"),
            "catalog_path": catalog_movie.get("_catalog_path"),
            "catalog_line": catalog_movie.get("_catalog_line"),
            "catalog_title": catalog_title,
            "catalog_year": catalog_year,
            "title": title,
            "year": page.get("year") or catalog_year,
            "writers": [],
            "writer": "",
            "synopsis": extract_subslikescript_plot(soup) or strip_html(catalog_movie.get("synopsis") or catalog_movie.get("overview")),
            "page_url": page["url"],
            "source_url": page["url"],
            "subslikescript_heading": heading,
            "script": script_text,
            "script_text": script_text,
        }

        output_path = output_root / "movies" / f"{sanitize_path_part(title, 'movie')}.json"
        save_json(output_path, payload)
        logger.info("%s Saved %s from Subs like Script -> %s", log_prefix, title, output_path)
        return

    raise LookupError(last_reason or f"Subs like Script did not expose a readable movie transcript for {catalog_title}")


def scrape_movie_from_bbc_writers(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    index: int,
    total: int,
):
    catalog_title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    catalog_year = extract_year(catalog_movie.get("year") or catalog_movie.get("releaseDate"))
    log_prefix = f"[Movie {index}/{total}]"

    movie = search_bbc_movie_entry(session, catalog_movie, logger, log_prefix)
    page_url = movie["page_url"]
    soup = BeautifulSoup(fetch_html(session, page_url), "html.parser")
    pdf_items = extract_bbc_pdf_items(soup)
    if not pdf_items:
        raise LookupError(f"BBC Writers matched {catalog_title} but no script PDF links were present.")
    logger.info("%s BBC Writers matched movie page: %s", log_prefix, page_url)
    last_reason = ""

    for item_index, script_item in enumerate(pdf_items, start=1):
        item_prefix = f"{log_prefix} [Match {item_index}/{len(pdf_items)}]"
        logger.info("%s Writers: %s", item_prefix, ", ".join(script_item["writers"]) if script_item["writers"] else "Unknown")

        try:
            script_text, page_count = extract_pdf_text(session, script_item["pdf_url"], logger, item_prefix)
        except (LookupError, ValueError, requests.RequestException) as error:
            last_reason = str(error)
            logger.warning("%s %s", item_prefix, error)
            continue

        if not script_text:
            last_reason = f"BBC Writers PDF extracted empty text for movie: {catalog_title}"
            logger.warning("%s %s", item_prefix, last_reason)
            continue

        title = normalize_whitespace(movie.get("title")) or catalog_title
        payload = {
            "media_type": "movie",
            "source_site": "BBC Writers",
            "sources_checked": ["Script Slug", "IMSDb", "8FLiX", "Subs like Script", "BBC Writers"],
            "catalog_source": catalog_movie.get("source"),
            "catalog_source_key": catalog_movie.get("sourceKey"),
            "catalog_path": catalog_movie.get("_catalog_path"),
            "catalog_line": catalog_movie.get("_catalog_line"),
            "catalog_title": catalog_title,
            "catalog_year": catalog_year,
            "title": title,
            "year": catalog_year,
            "writers": script_item["writers"],
            "writer": script_item["writer"],
            "synopsis": extract_bbc_page_summary(soup) or strip_html(catalog_movie.get("synopsis") or catalog_movie.get("overview")),
            "page_url": page_url,
            "source_url": page_url,
            "bbc_category": movie.get("category"),
            "pdf_url": script_item["pdf_url"],
            "pdf_page_count": page_count,
            "script": script_text,
            "script_text": script_text,
        }

        output_path = output_root / "movies" / f"{sanitize_path_part(title, 'movie')}.json"
        save_json(output_path, payload)
        logger.info("%s Saved %s from BBC Writers -> %s", item_prefix, title, output_path)
        return

    raise LookupError(last_reason or f"BBC Writers did not expose a readable movie script for {catalog_title}")


def scrape_movie_from_daily_script(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    index: int,
    total: int,
):
    catalog_title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    catalog_year = extract_year(catalog_movie.get("year") or catalog_movie.get("releaseDate"))
    log_prefix = f"[Movie {index}/{total}]"
    entries = search_daily_script_movie_entries(session, catalog_movie, logger, log_prefix)
    last_reason = ""

    for entry_index, entry in enumerate(entries, start=1):
        entry_prefix = f"{log_prefix} [Match {entry_index}/{len(entries)}]"
        logger.info("%s Daily Script matched movie entry: %s", entry_prefix, entry["script_url"])
        logger.info("%s Writers: %s", entry_prefix, ", ".join(entry["writers"]) if entry["writers"] else "Unknown")

        try:
            script_text, page_count = extract_daily_script_text(session, entry, logger, entry_prefix)
        except (LookupError, ValueError, requests.RequestException) as error:
            last_reason = str(error)
            logger.warning("%s %s", entry_prefix, error)
            continue

        if not script_text:
            last_reason = f"Daily Script extracted empty text for movie: {catalog_title}"
            logger.warning("%s %s", entry_prefix, last_reason)
            continue

        title = normalize_whitespace(entry.get("title")) or catalog_title
        payload = {
            "media_type": "movie",
            "source_site": "Daily Script",
            "sources_checked": ["Script Slug", "IMSDb", "8FLiX", "Subs like Script", "BBC Writers", "Daily Script"],
            "catalog_source": catalog_movie.get("source"),
            "catalog_source_key": catalog_movie.get("sourceKey"),
            "catalog_path": catalog_movie.get("_catalog_path"),
            "catalog_line": catalog_movie.get("_catalog_line"),
            "catalog_title": catalog_title,
            "catalog_year": catalog_year,
            "title": title,
            "year": entry.get("year") or catalog_year,
            "writers": entry["writers"],
            "writer": entry["writer"],
            "synopsis": strip_html(catalog_movie.get("synopsis") or catalog_movie.get("overview")),
            "page_url": entry["script_url"],
            "source_url": entry["script_url"],
            "daily_script_details": entry.get("details"),
            "script_format": entry.get("script_format"),
            "pdf_page_count": page_count,
            "script": script_text,
            "script_text": script_text,
        }

        output_path = output_root / "movies" / f"{sanitize_path_part(title, 'movie')}.json"
        save_json(output_path, payload)
        logger.info("%s Saved %s from Daily Script -> %s", entry_prefix, title, output_path)
        return

    raise LookupError(last_reason or f"Daily Script did not expose a readable movie script for {catalog_title}")


def scrape_movie_from_script_hive(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    index: int,
    total: int,
):
    catalog_title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    catalog_year = extract_year(catalog_movie.get("year") or catalog_movie.get("releaseDate"))
    log_prefix = f"[Movie {index}/{total}]"

    matches = search_script_hive_movie_entries(session, catalog_movie, logger, log_prefix)
    last_reason = ""

    for row in matches:
        title = script_hive_display_title(row, catalog_title)
        writers = script_hive_writers(row)
        logger.info(
            "%s ScriptHive matched movie entry: %s",
            log_prefix,
            normalize_whitespace(row.get("URL")) or normalize_whitespace(row.get("Title")) or title,
        )
        logger.info("%s Writers: %s", log_prefix, ", ".join(writers) if writers else "Unknown")

        try:
            script_text, page_count, resolved_url = download_script_hive_text(session, row, logger, log_prefix)
        except LookupError as error:
            last_reason = str(error)
            continue

        payload = {
            "media_type": "movie",
            "source_site": "ScriptHive",
            "sources_checked": [
                "Script Slug",
                "IMSDb",
                "8FLiX",
                "Subs like Script",
                "BBC Writers",
                "Daily Script",
                "ScriptHive",
            ],
            "catalog_source": catalog_movie.get("source"),
            "catalog_source_key": catalog_movie.get("sourceKey"),
            "catalog_path": catalog_movie.get("_catalog_path"),
            "catalog_line": catalog_movie.get("_catalog_line"),
            "catalog_title": catalog_title,
            "catalog_year": catalog_year,
            "title": title,
            "year": script_hive_candidate_year(row) or catalog_year,
            "writers": writers,
            "writer": ", ".join(writers),
            "synopsis": strip_html(catalog_movie.get("synopsis") or catalog_movie.get("overview")),
            "page_url": normalize_whitespace(row.get("URL")) or SCRIPT_HIVE_BASE_URL,
            "source_url": script_hive_source_url(row, resolved_url),
            "script_hive_category": script_hive_category(row),
            "script_hive_folder": script_hive_folder(row),
            "script_hive_file_type": script_hive_file_type(row),
            "script_hive_document_type": script_hive_document_type(row),
            "script_hive_draft_date": script_hive_draft_date(row),
            "script_hive_alternate_titles": script_hive_alternate_titles(row),
            "script_hive_file_id": script_hive_file_id(row),
            "script_hive_google_drive_id": script_hive_google_drive_id(row),
            "pdf_page_count": page_count,
            "script": script_text,
            "script_text": script_text,
        }

        output_path = output_root / "movies" / f"{sanitize_path_part(title, 'movie')}.json"
        save_json(output_path, payload)
        logger.info("%s Saved %s from ScriptHive -> %s", log_prefix, title, output_path)
        return

    raise LookupError(last_reason or f"ScriptHive did not expose a readable movie script for {catalog_title}")


def scrape_movie_from_blacklist(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    index: int,
    total: int,
):
    catalog_title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    catalog_year = extract_year(catalog_movie.get("year") or catalog_movie.get("releaseDate"))
    log_prefix = f"[Movie {index}/{total}]"
    entries = search_blacklist_movie_entries(session, catalog_movie, logger, log_prefix)
    last_reason = ""

    for entry_index, entry in enumerate(entries, start=1):
        entry_prefix = f"{log_prefix} [Match {entry_index}/{len(entries)}]"
        logger.info("%s Go Into The Story matched movie entry: %s", entry_prefix, entry["script_url"])

        try:
            script_text, page_count, resolved_url = extract_blacklist_script_text(session, entry, logger, entry_prefix)
        except (LookupError, ValueError, requests.RequestException) as error:
            last_reason = str(error)
            logger.warning("%s %s", entry_prefix, error)
            continue

        title = normalize_whitespace(entry.get("title")) or catalog_title
        payload = {
            "media_type": "movie",
            "source_site": "Go Into The Story",
            "sources_checked": MOVIE_FALLBACK_SOURCES,
            "catalog_source": catalog_movie.get("source"),
            "catalog_source_key": catalog_movie.get("sourceKey"),
            "catalog_path": catalog_movie.get("_catalog_path"),
            "catalog_line": catalog_movie.get("_catalog_line"),
            "catalog_title": catalog_title,
            "catalog_year": catalog_year,
            "title": title,
            "year": catalog_year,
            "writers": [],
            "writer": "",
            "synopsis": strip_html(catalog_movie.get("synopsis") or catalog_movie.get("overview")),
            "page_url": entry["source_url"],
            "source_url": resolved_url,
            "blacklist_script_url": entry["script_url"],
            "pdf_page_count": page_count,
            "script": script_text,
            "script_text": script_text,
        }

        output_path = output_root / "movies" / f"{sanitize_path_part(title, 'movie')}.json"
        save_json(output_path, payload)
        logger.info("%s Saved %s from Go Into The Story -> %s", entry_prefix, title, output_path)
        return

    raise LookupError(last_reason or f"Go Into The Story did not expose a readable movie script for {catalog_title}")


def scrape_movie_from_awesomefilm(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    index: int,
    total: int,
):
    catalog_title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    catalog_year = extract_year(catalog_movie.get("year") or catalog_movie.get("releaseDate"))
    log_prefix = f"[Movie {index}/{total}]"
    entries = search_awesomefilm_movie_entries(session, catalog_movie, logger, log_prefix)
    last_reason = ""

    for entry_index, entry in enumerate(entries, start=1):
        entry_prefix = f"{log_prefix} [Match {entry_index}/{len(entries)}]"
        logger.info("%s AwesomeFilm matched movie entry: %s", entry_prefix, entry["script_url"])

        try:
            script_text, page_count = extract_awesomefilm_text(session, entry, logger, entry_prefix)
        except (LookupError, ValueError, requests.RequestException) as error:
            last_reason = str(error)
            logger.warning("%s %s", entry_prefix, error)
            continue

        title = normalize_whitespace(entry.get("title")) or catalog_title
        payload = {
            "media_type": "movie",
            "source_site": "AwesomeFilm",
            "sources_checked": MOVIE_FALLBACK_SOURCES,
            "catalog_source": catalog_movie.get("source"),
            "catalog_source_key": catalog_movie.get("sourceKey"),
            "catalog_path": catalog_movie.get("_catalog_path"),
            "catalog_line": catalog_movie.get("_catalog_line"),
            "catalog_title": catalog_title,
            "catalog_year": catalog_year,
            "title": title,
            "year": catalog_year,
            "writers": [],
            "writer": "",
            "synopsis": strip_html(catalog_movie.get("synopsis") or catalog_movie.get("overview")),
            "page_url": AWESOMEFILM_INDEX_URL,
            "source_url": entry["script_url"],
            "awesomefilm_raw_title": entry.get("raw_title"),
            "script_format": entry.get("script_format"),
            "pdf_page_count": page_count,
            "script": script_text,
            "script_text": script_text,
        }

        output_path = output_root / "movies" / f"{sanitize_path_part(title, 'movie')}.json"
        save_json(output_path, payload)
        logger.info("%s Saved %s from AwesomeFilm -> %s", entry_prefix, title, output_path)
        return

    raise LookupError(last_reason or f"AwesomeFilm did not expose a readable movie script for {catalog_title}")


def scrape_movie_from_sfy(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    index: int,
    total: int,
):
    catalog_title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    catalog_year = extract_year(catalog_movie.get("year") or catalog_movie.get("releaseDate"))
    log_prefix = f"[Movie {index}/{total}]"
    entries = search_sfy_movie_entries(session, catalog_movie, logger, log_prefix)
    last_reason = ""

    for entry_index, entry in enumerate(entries, start=1):
        entry_prefix = f"{log_prefix} [Match {entry_index}/{len(entries)}]"
        logger.info("%s Screenplays for You matched movie entry: %s", entry_prefix, entry["script_url"])

        try:
            script_text, page_count = extract_sfy_text(session, entry, logger, entry_prefix)
        except (LookupError, ValueError, requests.RequestException) as error:
            last_reason = str(error)
            logger.warning("%s %s", entry_prefix, error)
            continue

        title = normalize_whitespace(entry.get("title")) or catalog_title
        payload = {
            "media_type": "movie",
            "source_site": "Screenplays for You",
            "sources_checked": MOVIE_FALLBACK_SOURCES,
            "catalog_source": catalog_movie.get("source"),
            "catalog_source_key": catalog_movie.get("sourceKey"),
            "catalog_path": catalog_movie.get("_catalog_path"),
            "catalog_line": catalog_movie.get("_catalog_line"),
            "catalog_title": catalog_title,
            "catalog_year": catalog_year,
            "title": title,
            "year": catalog_year,
            "writers": [],
            "writer": "",
            "synopsis": strip_html(catalog_movie.get("synopsis") or catalog_movie.get("overview")),
            "page_url": SFY_INDEX_URL,
            "source_url": entry["script_url"],
            "sfy_raw_title": entry.get("raw_title"),
            "script_format": entry.get("script_format"),
            "pdf_page_count": page_count,
            "script": script_text,
            "script_text": script_text,
        }

        output_path = output_root / "movies" / f"{sanitize_path_part(title, 'movie')}.json"
        save_json(output_path, payload)
        logger.info("%s Saved %s from Screenplays for You -> %s", entry_prefix, title, output_path)
        return

    raise LookupError(last_reason or f"Screenplays for You did not expose a readable movie script for {catalog_title}")


def scrape_movie_from_screenplaydb(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    index: int,
    total: int,
):
    log_prefix = f"[Movie {index}/{total}]"
    search_screenplaydb_movie_entry(session, catalog_movie, logger, log_prefix)


def scrape_movie_from_moviescriptsandscreenplays(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    index: int,
    total: int,
):
    catalog_title = normalize_whitespace(catalog_movie.get("title")) or "Untitled Movie"
    catalog_year = extract_year(catalog_movie.get("year") or catalog_movie.get("releaseDate"))
    log_prefix = f"[Movie {index}/{total}]"
    entries = search_moviescriptsandscreenplays_movie_entries(session, catalog_movie, logger, log_prefix)
    last_reason = ""

    for entry_index, entry in enumerate(entries, start=1):
        entry_prefix = f"{log_prefix} [Match {entry_index}/{len(entries)}]"
        logger.info("%s Movie Scripts and Screenplays matched movie entry: %s", entry_prefix, entry["script_url"])

        try:
            script_text, page_count, resolved_url = extract_moviescriptsandscreenplays_text(
                session, entry, logger, entry_prefix
            )
        except (LookupError, ValueError, requests.RequestException) as error:
            last_reason = str(error)
            logger.warning("%s %s", entry_prefix, error)
            continue

        title = normalize_whitespace(entry.get("title")) or catalog_title
        writers = entry.get("writers") or []
        payload = {
            "media_type": "movie",
            "source_site": "Movie Scripts and Screenplays",
            "sources_checked": MOVIE_FALLBACK_SOURCES,
            "catalog_source": catalog_movie.get("source"),
            "catalog_source_key": catalog_movie.get("sourceKey"),
            "catalog_path": catalog_movie.get("_catalog_path"),
            "catalog_line": catalog_movie.get("_catalog_line"),
            "catalog_title": catalog_title,
            "catalog_year": catalog_year,
            "title": title,
            "year": catalog_year,
            "writers": writers,
            "writer": ", ".join(writers),
            "synopsis": strip_html(catalog_movie.get("synopsis") or catalog_movie.get("overview")),
            "page_url": entry.get("index_url"),
            "source_url": resolved_url,
            "moviescriptsandscreenplays_script_url": entry["script_url"],
            "moviescriptsandscreenplays_raw_title": entry.get("raw_title"),
            "moviescriptsandscreenplays_draft_info": entry.get("draft_info"),
            "moviescriptsandscreenplays_host_url": entry.get("host_url"),
            "moviescriptsandscreenplays_info_url": entry.get("info_url"),
            "script_format": entry.get("script_format"),
            "pdf_page_count": page_count,
            "script": script_text,
            "script_text": script_text,
        }

        output_path = output_root / "movies" / f"{sanitize_path_part(title, 'movie')}.json"
        save_json(output_path, payload)
        logger.info("%s Saved %s from Movie Scripts and Screenplays -> %s", entry_prefix, title, output_path)
        return

    raise LookupError(
        last_reason or f"Movie Scripts and Screenplays did not expose a readable movie script for {catalog_title}"
    )


def scrape_movie(
    session: requests.Session,
    catalog_movie: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    index: int,
    total: int,
):
    reasons: list[str] = []
    for source_name, handler in [
        ("Script Slug", scrape_movie_from_script_slug),
        ("IMSDb", scrape_movie_from_imsdb),
        ("8FLiX", scrape_movie_from_8flix),
        ("Subs like Script", scrape_movie_from_subslikescript),
        ("BBC Writers", scrape_movie_from_bbc_writers),
        ("Daily Script", scrape_movie_from_daily_script),
        ("ScriptHive", scrape_movie_from_script_hive),
        ("Go Into The Story", scrape_movie_from_blacklist),
        ("AwesomeFilm", scrape_movie_from_awesomefilm),
        ("Screenplays for You", scrape_movie_from_sfy),
        ("ScreenplayDB", scrape_movie_from_screenplaydb),
        ("Movie Scripts and Screenplays", scrape_movie_from_moviescriptsandscreenplays),
    ]:
        try:
            handler(session, catalog_movie, output_root, logger, index, total)
            return
        except (LookupError, ValueError, requests.RequestException) as error:
            logger.warning("[Movie %s/%s] %s failed: %s", index, total, source_name, error)
            reasons.append(f"{source_name}: {error}")

    raise LookupError(" | ".join(reasons))


def scrape_tv_show_from_script_slug(
    session: requests.Session,
    catalog_show: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    show_index: int,
    show_total: int,
    episode_limit: int | None,
):
    catalog_title = normalize_whitespace(catalog_show.get("title")) or "Untitled Show"
    catalog_year = extract_year(catalog_show.get("year") or catalog_show.get("releaseDate"))
    log_prefix = f"[TV {show_index}/{show_total}]"

    logger.info(
        "%s Catalog entry: %s (%s) from %s:%s",
        log_prefix,
        catalog_title,
        str(catalog_year or "?"),
        catalog_show.get("_catalog_path"),
        catalog_show.get("_catalog_line"),
    )

    show, search_term = search_show_entry(session, catalog_show, logger, log_prefix)
    show_name = normalize_whitespace(show.get("seriesTitle") or show.get("title")) or catalog_title
    show_id = str(show.get("id") or "")
    show_url = show.get("url") or ""
    if not show_id:
        raise ValueError(f"Missing show id for {show_name}")

    logger.info("%s Matched online TV show with search term \"%s\": %s", log_prefix, search_term, show_url)
    episodes = discover_show_episodes(session, logger, show_id, show_name, episode_limit)
    logger.info("%s Found %s episode script(s) for %s", log_prefix, len(episodes), show_name)

    if not episodes:
        raise LookupError(f"No TV episode scripts found online for {catalog_title}")

    show_dir = output_root / "tv_shows" / sanitize_path_part(show_name, "tv_show")

    for episode_index, episode in enumerate(episodes, start=1):
        episode_title = normalize_whitespace(episode.get("episodeTitle")) or "Untitled Episode"
        season_number = episode.get("seasonNumber")
        episode_number = episode.get("episodeNumber")
        pdf_asset = script_asset(episode)
        writers = writer_names(episode)
        episode_prefix = f"{log_prefix} [Episode {episode_index}/{len(episodes)}]"

        logger.info(
            "%s Processing %s - %s (S%sE%s)",
            episode_prefix,
            show_name,
            episode_title,
            str(season_number or "?"),
            str(episode_number or "?"),
        )
        logger.info("%s Writers: %s", episode_prefix, ", ".join(writers) if writers else "Unknown")

        if episode.get("comingSoon"):
            raise ValueError(f"Script marked as coming soon for episode: {show_name} - {episode_title}")
        if not pdf_asset:
            raise ValueError(f"Could not find a PDF asset for episode: {show_name} - {episode_title}")

        pdf_url = pdf_asset["url"]
        script_text, page_count = extract_pdf_text(session, pdf_url, logger, episode_prefix)
        if not script_text:
            raise ValueError(f"Extracted empty script text for episode: {show_name} - {episode_title}")

        payload = {
            "media_type": "tv_episode",
            "source_site": "Script Slug",
            "sources_checked": ["Script Slug"],
            "catalog_source": catalog_show.get("source"),
            "catalog_source_key": catalog_show.get("sourceKey"),
            "catalog_path": catalog_show.get("_catalog_path"),
            "catalog_line": catalog_show.get("_catalog_line"),
            "catalog_title": catalog_title,
            "catalog_year": catalog_year,
            "show_name": show_name,
            "series": show_name,
            "show_year": show.get("year"),
            "episode_title": episode_title,
            "season_number": season_number,
            "episode_number": episode_number,
            "year": episode.get("year"),
            "writers": writers,
            "writer": ", ".join(writers),
            "synopsis": strip_html(episode.get("synopsis")),
            "show_url": show_url,
            "source_url": episode.get("url"),
            "page_url": episode.get("url"),
            "script_slug_uri": episode.get("uri"),
            "pdf_url": pdf_url,
            "pdf_filename": pdf_asset.get("filename"),
            "pdf_title": pdf_asset.get("title"),
            "pdf_page_count": page_count,
            "script": script_text,
            "script_text": script_text,
        }

        output_path = unique_episode_path(show_dir, episode_title, season_number, episode_number)
        save_json(output_path, payload)
        logger.info("%s Saved %s -> %s", episode_prefix, episode_title, output_path)


def scrape_tv_show_from_imsdb(
    session: requests.Session,
    catalog_show: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    show_index: int,
    show_total: int,
    episode_limit: int | None,
):
    catalog_title = normalize_whitespace(catalog_show.get("title")) or "Untitled Show"
    catalog_year = extract_year(catalog_show.get("year") or catalog_show.get("releaseDate"))
    log_prefix = f"[TV {show_index}/{show_total}]"

    show = search_imsdb_show_entry(session, catalog_show, logger, log_prefix)
    show_name = normalize_whitespace(show.get("show_name")) or catalog_title
    show_url = show["show_url"]
    show_html = fetch_html(session, show_url)
    episode_records = extract_tv_episode_records(show_html, show_url)
    if episode_limit is not None:
        episode_records = episode_records[:episode_limit]

    logger.info("%s IMSDb matched TV page: %s", log_prefix, show_url)
    logger.info("%s Found %s IMSDb episode transcript link(s) for %s", log_prefix, len(episode_records), show_name)
    if not episode_records:
        raise LookupError(f"No IMSDb episode transcripts found for {catalog_title}")

    show_dir = output_root / "tv_shows" / sanitize_path_part(show_name, "tv_show")
    saved_any = False

    for episode_index, episode in enumerate(episode_records, start=1):
        episode_title = normalize_whitespace(episode.get("episode_title")) or "Untitled Episode"
        episode_prefix = f"{log_prefix} [Episode {episode_index}/{len(episode_records)}]"
        metadata_url = episode["metadata_url"]
        metadata_html = fetch_html(session, metadata_url)
        metadata_soup = BeautifulSoup(metadata_html, "html.parser")
        read_url = extract_read_link(metadata_soup)
        if not read_url:
            logger.warning("%s IMSDb episode matched but had no read link: %s", episode_prefix, metadata_url)
            continue

        writers = episode.get("writers") or extract_sidebar_writers(metadata_soup)
        logger.info("%s Writers: %s", episode_prefix, ", ".join(writers) if writers else "Unknown")
        script_html = fetch_html(session, read_url, timeout=PDF_TIMEOUT_SECONDS)
        script_text = extract_script_text_from_read_page(script_html)
        if not script_text:
            logger.warning("%s IMSDb episode read page was empty: %s", episode_prefix, read_url)
            continue

        payload = {
            "media_type": "tv_episode",
            "source_site": "IMSDb",
            "sources_checked": ["Script Slug", "IMSDb"],
            "catalog_source": catalog_show.get("source"),
            "catalog_source_key": catalog_show.get("sourceKey"),
            "catalog_path": catalog_show.get("_catalog_path"),
            "catalog_line": catalog_show.get("_catalog_line"),
            "catalog_title": catalog_title,
            "catalog_year": catalog_year,
            "show_name": show_name,
            "series": episode.get("series") or show_name,
            "show_year": catalog_year,
            "episode_title": episode_title,
            "season_number": None,
            "episode_number": None,
            "year": extract_year(episode.get("air_date")),
            "air_date": episode.get("air_date"),
            "writers": writers,
            "writer": ", ".join(writers),
            "synopsis": strip_html(catalog_show.get("synopsis") or catalog_show.get("overview")),
            "show_url": show_url,
            "page_url": metadata_url,
            "source_url": read_url,
            "imsdb_metadata_url": metadata_url,
            "imsdb_read_url": read_url,
            "script": script_text,
            "script_text": script_text,
        }

        output_path = unique_episode_path(show_dir, episode_title, None, None)
        save_json(output_path, payload)
        logger.info("%s Saved %s from IMSDb -> %s", episode_prefix, episode_title, output_path)
        saved_any = True

    if not saved_any:
        raise LookupError(f"IMSDb matched {catalog_title}, but none of the episode transcript pages exposed script text.")


def scrape_tv_show_from_8flix(
    session: requests.Session,
    catalog_show: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    show_index: int,
    show_total: int,
    episode_limit: int | None,
):
    catalog_title = normalize_whitespace(catalog_show.get("title")) or "Untitled Show"
    catalog_year = extract_year(catalog_show.get("year") or catalog_show.get("releaseDate"))
    log_prefix = f"[TV {show_index}/{show_total}]"
    pages = search_8flix_entries(
        session,
        catalog_title,
        catalog_year,
        logger,
        log_prefix,
        (EIGHTFLIX_TV_PREFIX, EIGHTFLIX_TRANSCRIPTS_PREFIX),
    )
    if not pages:
        raise LookupError(f"No 8FLiX TV page match found for {catalog_title}")

    show_dir = output_root / "tv_shows" / sanitize_path_part(catalog_title, "tv_show")
    candidates = pages[:episode_limit] if episode_limit is not None else pages
    last_reason = ""

    for episode_index, page in enumerate(candidates, start=1):
        page_payload = fetch_8flix_page_payload(session, page)
        content_html = ((page_payload.get("content") or {}).get("rendered")) or ""
        soup = BeautifulSoup(content_html, "html.parser")
        details = table_rows_to_dict(soup.find("table"))
        writers = parse_people_list(
            details.get("Teleplay") or details.get("Screenplay") or details.get("Writer") or ""
        )
        episode_prefix = f"{log_prefix} [8FLiX {episode_index}/{len(candidates)}]"
        logger.info("%s 8FLiX matched page: %s", episode_prefix, page["url"])
        logger.info("%s Writers: %s", episode_prefix, ", ".join(writers) if writers else "Unknown")

        script_text = maybe_extract_8flix_public_script_text(content_html)
        if not script_text:
            last_reason = f"8FLiX matched {catalog_title}, but the public page(s) did not expose full teleplay/transcript text."
            continue

        title_text = normalize_whitespace(unescape((page_payload.get("title") or {}).get("rendered"))) or page["title"]
        episode_title = title_text
        if "#" in title_text:
            episode_title = normalize_whitespace(re.sub(r"^.*?#\d+(?:\.\d+)?\s*", "", title_text))
        episode_title = re.sub(r"\s+(Teleplay|Transcript|Screenplay)$", "", episode_title, flags=re.IGNORECASE).strip() or title_text
        season_number, episode_number = extract_8flix_episode_identity(details.get("Episode", ""))
        show_name = catalog_title

        payload = {
            "media_type": "tv_episode",
            "source_site": "8FLiX",
            "sources_checked": ["Script Slug", "IMSDb", "8FLiX"],
            "catalog_source": catalog_show.get("source"),
            "catalog_source_key": catalog_show.get("sourceKey"),
            "catalog_path": catalog_show.get("_catalog_path"),
            "catalog_line": catalog_show.get("_catalog_line"),
            "catalog_title": catalog_title,
            "catalog_year": catalog_year,
            "show_name": show_name,
            "series": show_name,
            "show_year": catalog_year,
            "episode_title": episode_title,
            "season_number": season_number,
            "episode_number": episode_number,
            "year": catalog_year,
            "writers": writers,
            "writer": ", ".join(writers),
            "synopsis": extract_8flix_logline(soup) or strip_html(catalog_show.get("synopsis") or catalog_show.get("overview")),
            "show_url": page["url"],
            "page_url": page["url"],
            "source_url": page["url"],
            "eightflix_page_id": page_payload.get("id"),
            "script_type": details.get("Type"),
            "script_version": details.get("Version"),
            "script_date": details.get("Date"),
            "page_count": details.get("Pages"),
            "script": script_text,
            "script_text": script_text,
        }

        output_path = unique_episode_path(show_dir, episode_title, season_number, episode_number)
        save_json(output_path, payload)
        logger.info("%s Saved %s from 8FLiX -> %s", episode_prefix, episode_title, output_path)
        return

    raise LookupError(last_reason or f"8FLiX did not expose readable TV scripts for {catalog_title}")


def scrape_tv_show_from_subslikescript(
    session: requests.Session,
    catalog_show: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    show_index: int,
    show_total: int,
    episode_limit: int | None,
):
    catalog_title = normalize_whitespace(catalog_show.get("title")) or "Untitled Show"
    catalog_year = extract_year(catalog_show.get("year") or catalog_show.get("releaseDate"))
    log_prefix = f"[TV {show_index}/{show_total}]"
    pages = search_subslikescript_entries(
        session,
        catalog_title,
        catalog_year,
        logger,
        log_prefix,
        (SUBSLIKESCRIPT_SERIES_PREFIX,),
    )
    if not pages:
        raise LookupError(f"No Subs like Script TV match found for {catalog_title}")

    last_reason = ""
    for page in pages:
        if "/season-" in page["url"]:
            continue

        logger.info("%s Subs like Script matched TV page: %s", log_prefix, page["url"])
        show_soup = BeautifulSoup(fetch_html(session, page["url"]), "html.parser")
        show_heading = extract_subslikescript_heading(show_soup)
        show_name = extract_subslikescript_show_name(show_heading, catalog_title)
        episode_records = extract_subslikescript_episode_records(str(show_soup), page["url"])
        if episode_limit is not None:
            episode_records = episode_records[:episode_limit]

        logger.info(
            "%s Found %s Subs like Script episode transcript link(s) for %s",
            log_prefix,
            len(episode_records),
            show_name,
        )
        if not episode_records:
            last_reason = f"Subs like Script matched {catalog_title}, but no episode transcript links were listed."
            continue

        show_dir = output_root / "tv_shows" / sanitize_path_part(show_name, "tv_show")
        saved_any = False

        for episode_index, episode in enumerate(episode_records, start=1):
            episode_prefix = f"{log_prefix} [Episode {episode_index}/{len(episode_records)}]"
            episode_soup = BeautifulSoup(fetch_html(session, episode["page_url"]), "html.parser")
            episode_heading = extract_subslikescript_heading(episode_soup)
            script_text = extract_subslikescript_script_text(episode_soup)
            if not script_text:
                logger.warning("%s Subs like Script episode page was empty: %s", episode_prefix, episode["page_url"])
                continue

            logger.info("%s Writers: Unknown", episode_prefix)
            payload = {
                "media_type": "tv_episode",
                "source_site": "Subs like Script",
                "sources_checked": ["Script Slug", "IMSDb", "8FLiX", "Subs like Script"],
                "catalog_source": catalog_show.get("source"),
                "catalog_source_key": catalog_show.get("sourceKey"),
                "catalog_path": catalog_show.get("_catalog_path"),
                "catalog_line": catalog_show.get("_catalog_line"),
                "catalog_title": catalog_title,
                "catalog_year": catalog_year,
                "show_name": show_name,
                "series": show_name,
                "show_year": page.get("year") or catalog_year,
                "episode_title": episode["episode_title"],
                "season_number": episode["season_number"],
                "episode_number": episode["episode_number"],
                "year": page.get("year") or catalog_year,
                "writers": [],
                "writer": "",
                "synopsis": extract_subslikescript_plot(episode_soup) or strip_html(catalog_show.get("synopsis") or catalog_show.get("overview")),
                "show_url": page["url"],
                "page_url": episode["page_url"],
                "source_url": episode["page_url"],
                "subslikescript_heading": episode_heading,
                "script": script_text,
                "script_text": script_text,
            }

            output_path = unique_episode_path(
                show_dir,
                episode["episode_title"],
                episode["season_number"],
                episode["episode_number"],
            )
            save_json(output_path, payload)
            logger.info("%s Saved %s from Subs like Script -> %s", episode_prefix, episode["episode_title"], output_path)
            saved_any = True

        if saved_any:
            return

        last_reason = f"Subs like Script matched {catalog_title}, but the episode transcript pages were empty."

    raise LookupError(last_reason or f"Subs like Script did not expose readable TV transcripts for {catalog_title}")


def scrape_tv_show_from_bbc_writers(
    session: requests.Session,
    catalog_show: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    show_index: int,
    show_total: int,
    episode_limit: int | None,
):
    catalog_title = normalize_whitespace(catalog_show.get("title")) or "Untitled Show"
    catalog_year = extract_year(catalog_show.get("year") or catalog_show.get("releaseDate"))
    log_prefix = f"[TV {show_index}/{show_total}]"

    show = search_bbc_tv_entry(session, catalog_show, logger, log_prefix)
    page_url = show["page_url"]
    soup = BeautifulSoup(fetch_html(session, page_url), "html.parser")
    pdf_items = extract_bbc_pdf_items(soup)
    if episode_limit is not None:
        pdf_items = pdf_items[:episode_limit]

    show_name = normalize_whitespace(show.get("title")) or catalog_title
    logger.info("%s BBC Writers matched TV page: %s", log_prefix, page_url)
    logger.info("%s Found %s BBC Writers script PDF(s) for %s", log_prefix, len(pdf_items), show_name)
    if not pdf_items:
        raise LookupError(f"BBC Writers matched {catalog_title}, but no episode script PDFs were listed.")

    show_dir = output_root / "tv_shows" / sanitize_path_part(show_name, "tv_show")
    saved_any = False

    for episode_index, item in enumerate(pdf_items, start=1):
        episode_title = normalize_whitespace(item.get("title")) or f"Series {item.get('season_number')}, Episode {item.get('episode_number')}"
        episode_prefix = f"{log_prefix} [Episode {episode_index}/{len(pdf_items)}]"
        logger.info("%s Writers: %s", episode_prefix, ", ".join(item["writers"]) if item["writers"] else "Unknown")

        script_text, page_count = extract_pdf_text(session, item["pdf_url"], logger, episode_prefix)
        if not script_text:
            logger.warning("%s BBC Writers PDF extracted empty text: %s", episode_prefix, item["pdf_url"])
            continue

        payload = {
            "media_type": "tv_episode",
            "source_site": "BBC Writers",
            "sources_checked": ["Script Slug", "IMSDb", "8FLiX", "Subs like Script", "BBC Writers"],
            "catalog_source": catalog_show.get("source"),
            "catalog_source_key": catalog_show.get("sourceKey"),
            "catalog_path": catalog_show.get("_catalog_path"),
            "catalog_line": catalog_show.get("_catalog_line"),
            "catalog_title": catalog_title,
            "catalog_year": catalog_year,
            "show_name": show_name,
            "series": show_name,
            "show_year": catalog_year,
            "episode_title": episode_title,
            "season_number": item["season_number"],
            "episode_number": item["episode_number"],
            "year": catalog_year,
            "writers": item["writers"],
            "writer": item["writer"],
            "synopsis": extract_bbc_page_summary(soup) or strip_html(catalog_show.get("synopsis") or catalog_show.get("overview")),
            "show_url": page_url,
            "page_url": page_url,
            "source_url": page_url,
            "bbc_category": show.get("category"),
            "pdf_url": item["pdf_url"],
            "pdf_page_count": page_count,
            "script": script_text,
            "script_text": script_text,
        }

        output_path = unique_episode_path(show_dir, episode_title, item["season_number"], item["episode_number"])
        save_json(output_path, payload)
        logger.info("%s Saved %s from BBC Writers -> %s", episode_prefix, episode_title, output_path)
        saved_any = True

    if not saved_any:
        raise LookupError(f"BBC Writers matched {catalog_title}, but none of the script PDFs extracted readable text.")


def scrape_tv_show_from_daily_script(
    session: requests.Session,
    catalog_show: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    show_index: int,
    show_total: int,
    episode_limit: int | None,
):
    catalog_title = normalize_whitespace(catalog_show.get("title")) or "Untitled Show"
    catalog_year = extract_year(catalog_show.get("year") or catalog_show.get("releaseDate"))
    log_prefix = f"[TV {show_index}/{show_total}]"

    entries = search_daily_script_tv_entries(session, catalog_show, logger, log_prefix)
    if episode_limit is not None:
        entries = entries[:episode_limit]

    logger.info("%s Found %s Daily Script episode entry(s) for %s", log_prefix, len(entries), catalog_title)
    show_dir = output_root / "tv_shows" / sanitize_path_part(catalog_title, "tv_show")
    saved_any = False

    for episode_index, entry in enumerate(entries, start=1):
        episode_prefix = f"{log_prefix} [Episode {episode_index}/{len(entries)}]"
        episode_title = normalize_whitespace(entry.get("title")) or "Untitled Episode"
        logger.info("%s Daily Script matched TV entry: %s", episode_prefix, entry["script_url"])
        logger.info("%s Writers: %s", episode_prefix, ", ".join(entry["writers"]) if entry["writers"] else "Unknown")

        script_text, page_count = extract_daily_script_text(session, entry, logger, episode_prefix)
        if not script_text:
            logger.warning("%s Daily Script extracted empty text: %s", episode_prefix, entry["script_url"])
            continue

        payload = {
            "media_type": "tv_episode",
            "source_site": "Daily Script",
            "sources_checked": ["Script Slug", "IMSDb", "8FLiX", "Subs like Script", "BBC Writers", "Daily Script"],
            "catalog_source": catalog_show.get("source"),
            "catalog_source_key": catalog_show.get("sourceKey"),
            "catalog_path": catalog_show.get("_catalog_path"),
            "catalog_line": catalog_show.get("_catalog_line"),
            "catalog_title": catalog_title,
            "catalog_year": catalog_year,
            "show_name": catalog_title,
            "series": catalog_title,
            "show_year": catalog_year,
            "episode_title": episode_title,
            "season_number": None,
            "episode_number": None,
            "year": entry.get("year") or catalog_year,
            "writers": entry["writers"],
            "writer": entry["writer"],
            "synopsis": strip_html(catalog_show.get("synopsis") or catalog_show.get("overview")),
            "show_url": DAILY_SCRIPT_TV_INDEX_URL,
            "page_url": entry["script_url"],
            "source_url": entry["script_url"],
            "daily_script_details": entry.get("details"),
            "script_format": entry.get("script_format"),
            "pdf_page_count": page_count,
            "script": script_text,
            "script_text": script_text,
        }

        output_path = unique_episode_path(show_dir, episode_title, None, None)
        save_json(output_path, payload)
        logger.info("%s Saved %s from Daily Script -> %s", episode_prefix, episode_title, output_path)
        saved_any = True

    if not saved_any:
        raise LookupError(f"Daily Script matched {catalog_title}, but none of the available entries produced readable text.")


def scrape_tv_show_from_script_hive(
    session: requests.Session,
    catalog_show: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    show_index: int,
    show_total: int,
    episode_limit: int | None,
):
    catalog_title = normalize_whitespace(catalog_show.get("title")) or "Untitled Show"
    catalog_year = extract_year(catalog_show.get("year") or catalog_show.get("releaseDate"))
    log_prefix = f"[TV {show_index}/{show_total}]"

    entries = search_script_hive_tv_entries(session, catalog_show, logger, log_prefix)
    if episode_limit is not None:
        entries = entries[:episode_limit]

    show_name = normalize_whitespace(entries[0].get("_show_name")) or catalog_title
    logger.info("%s Found %s ScriptHive episode entry(s) for %s", log_prefix, len(entries), show_name)

    show_dir = output_root / "tv_shows" / sanitize_path_part(show_name, "tv_show")
    saved_any = False
    last_reason = ""

    for episode_index, row in enumerate(entries, start=1):
        episode_prefix = f"{log_prefix} [Episode {episode_index}/{len(entries)}]"
        episode_title = normalize_whitespace(row.get("_episode_title")) or "Untitled Episode"
        season_number = row.get("_season_number")
        episode_number = row.get("_episode_number")
        writers = script_hive_writers(row)

        logger.info(
            "%s ScriptHive matched TV entry: %s",
            episode_prefix,
            normalize_whitespace(row.get("URL")) or normalize_whitespace(row.get("Title")) or episode_title,
        )
        logger.info("%s Writers: %s", episode_prefix, ", ".join(writers) if writers else "Unknown")

        try:
            script_text, page_count, resolved_url = download_script_hive_text(session, row, logger, episode_prefix)
        except LookupError as error:
            last_reason = str(error)
            logger.warning("%s %s", episode_prefix, error)
            continue

        payload = {
            "media_type": "tv_episode",
            "source_site": "ScriptHive",
            "sources_checked": [
                "Script Slug",
                "IMSDb",
                "8FLiX",
                "Subs like Script",
                "BBC Writers",
                "Daily Script",
                "ScriptHive",
            ],
            "catalog_source": catalog_show.get("source"),
            "catalog_source_key": catalog_show.get("sourceKey"),
            "catalog_path": catalog_show.get("_catalog_path"),
            "catalog_line": catalog_show.get("_catalog_line"),
            "catalog_title": catalog_title,
            "catalog_year": catalog_year,
            "show_name": show_name,
            "series": show_name,
            "show_year": script_hive_candidate_year(row) or catalog_year,
            "episode_title": episode_title,
            "season_number": season_number,
            "episode_number": episode_number,
            "year": script_hive_candidate_year(row) or catalog_year,
            "writers": writers,
            "writer": ", ".join(writers),
            "synopsis": strip_html(catalog_show.get("synopsis") or catalog_show.get("overview")),
            "show_url": SCRIPT_HIVE_BASE_URL,
            "page_url": normalize_whitespace(row.get("URL")) or SCRIPT_HIVE_BASE_URL,
            "source_url": script_hive_source_url(row, resolved_url),
            "script_hive_category": script_hive_category(row),
            "script_hive_folder": script_hive_folder(row),
            "script_hive_file_type": script_hive_file_type(row),
            "script_hive_document_type": script_hive_document_type(row),
            "script_hive_draft_date": script_hive_draft_date(row),
            "script_hive_episode_code": script_hive_episode_code(row),
            "script_hive_file_id": script_hive_file_id(row),
            "script_hive_google_drive_id": script_hive_google_drive_id(row),
            "pdf_page_count": page_count,
            "script": script_text,
            "script_text": script_text,
        }

        output_path = unique_episode_path(show_dir, episode_title, season_number, episode_number)
        save_json(output_path, payload)
        logger.info("%s Saved %s from ScriptHive -> %s", episode_prefix, episode_title, output_path)
        saved_any = True

    if not saved_any:
        raise LookupError(last_reason or f"ScriptHive matched {catalog_title}, but none of the available files were publicly readable.")


def scrape_tv_show_from_studio_binder(
    session: requests.Session,
    catalog_show: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    show_index: int,
    show_total: int,
    episode_limit: int | None,
):
    catalog_title = normalize_whitespace(catalog_show.get("title")) or "Untitled Show"
    catalog_year = extract_year(catalog_show.get("year") or catalog_show.get("releaseDate"))
    log_prefix = f"[TV {show_index}/{show_total}]"

    entries = search_studio_binder_tv_entries(session, catalog_show, logger, log_prefix)
    if episode_limit is not None:
        entries = entries[:episode_limit]

    show_name = normalize_whitespace(entries[0].get("show_name")) or catalog_title
    logger.info("%s Found %s StudioBinder episode entry(s) for %s", log_prefix, len(entries), show_name)

    show_dir = output_root / "tv_shows" / sanitize_path_part(show_name, "tv_show")
    saved_any = False
    last_reason = ""

    for episode_index, entry in enumerate(entries, start=1):
        episode_prefix = f"{log_prefix} [Episode {episode_index}/{len(entries)}]"
        episode_title = normalize_whitespace(entry.get("episode_title")) or normalize_whitespace(entry.get("title")) or "Untitled Episode"

        logger.info(
            "%s StudioBinder matched TV entry: %s",
            episode_prefix,
            normalize_whitespace(entry.get("view_script_url")) or normalize_whitespace(entry.get("title_url")) or STUDIOBINDER_TV_SCRIPTS_URL,
        )
        logger.info("%s Writers: %s", episode_prefix, ", ".join(entry["writers"]) if entry["writers"] else "Unknown")

        try:
            script_text, page_count, resolved_url = extract_studio_binder_script_text(session, entry, logger, episode_prefix)
        except LookupError as error:
            last_reason = str(error)
            logger.warning("%s %s", episode_prefix, error)
            continue

        payload = {
            "media_type": "tv_episode",
            "source_site": "StudioBinder",
            "sources_checked": TV_FALLBACK_SOURCES,
            "catalog_source": catalog_show.get("source"),
            "catalog_source_key": catalog_show.get("sourceKey"),
            "catalog_path": catalog_show.get("_catalog_path"),
            "catalog_line": catalog_show.get("_catalog_line"),
            "catalog_title": catalog_title,
            "catalog_year": catalog_year,
            "show_name": show_name,
            "series": show_name,
            "show_year": catalog_year,
            "episode_title": episode_title,
            "season_number": entry.get("season_number"),
            "episode_number": entry.get("episode_number"),
            "year": catalog_year,
            "writers": entry["writers"],
            "writer": entry["writer"],
            "synopsis": entry.get("synopsis") or strip_html(catalog_show.get("synopsis") or catalog_show.get("overview")),
            "show_url": STUDIOBINDER_TV_SCRIPTS_URL,
            "page_url": normalize_whitespace(entry.get("title_url")) or STUDIOBINDER_TV_SCRIPTS_URL,
            "source_url": resolved_url,
            "studio_binder_view_url": entry.get("view_script_url"),
            "studio_binder_genres": entry.get("genres"),
            "pdf_page_count": page_count,
            "script": script_text,
            "script_text": script_text,
        }

        output_path = unique_episode_path(
            show_dir,
            episode_title,
            entry.get("season_number"),
            entry.get("episode_number"),
        )
        save_json(output_path, payload)
        logger.info("%s Saved %s from StudioBinder -> %s", episode_prefix, episode_title, output_path)
        saved_any = True

    if not saved_any:
        raise LookupError(last_reason or f"StudioBinder matched {catalog_title}, but none of the linked scripts were publicly readable.")


def scrape_tv_show(
    session: requests.Session,
    catalog_show: dict[str, Any],
    output_root: Path,
    logger: logging.Logger,
    show_index: int,
    show_total: int,
    episode_limit: int | None,
):
    reasons: list[str] = []
    for source_name, handler in [
        ("Script Slug", scrape_tv_show_from_script_slug),
        ("IMSDb", scrape_tv_show_from_imsdb),
        ("8FLiX", scrape_tv_show_from_8flix),
        ("Subs like Script", scrape_tv_show_from_subslikescript),
        ("BBC Writers", scrape_tv_show_from_bbc_writers),
        ("Daily Script", scrape_tv_show_from_daily_script),
        ("ScriptHive", scrape_tv_show_from_script_hive),
        ("StudioBinder", scrape_tv_show_from_studio_binder),
    ]:
        try:
            handler(session, catalog_show, output_root, logger, show_index, show_total, episode_limit)
            return
        except (LookupError, ValueError, requests.RequestException) as error:
            logger.warning("[TV %s/%s] %s failed: %s", show_index, show_total, source_name, error)
            reasons.append(f"{source_name}: {error}")

    raise LookupError(" | ".join(reasons))


def main():
    args = parse_args()
    catalog_root = Path(args.catalog_root)
    output_root = Path(args.output_root)
    log_file = Path(args.log_file)
    logger = configure_logging(log_file)
    session = build_session()

    logger.info(
        "Starting catalog-driven script scraper with mode=%s catalog_root=%s output_root=%s",
        args.mode,
        catalog_root,
        output_root,
    )

    movie_saved = 0
    tv_saved = 0
    missing_movie_entries: list[dict[str, Any]] = []
    missing_tv_entries: list[dict[str, Any]] = []

    try:
        if args.mode in {"all", "movies"}:
            movies = load_catalog_entries(catalog_root, "movie", logger, args.movie_limit)
            if args.movie_limit is not None:
                logger.info("Applying movie limit: %s", args.movie_limit)

            for index, movie in enumerate(movies, start=1):
                try:
                    scrape_movie(session, movie, output_root, logger, index, len(movies))
                    movie_saved += 1
                except LookupError as error:
                    logger.warning("[Movie %s/%s] %s", index, len(movies), error)
                    missing_payload = build_movie_not_found_payload(movie, str(error))
                    missing_output_path = output_root / "movies" / f"{sanitize_path_part(missing_payload['title'], 'movie')}.json"
                    missing_movie_entries.append(
                        build_missing_script_summary_entry(missing_payload, missing_output_path, output_root)
                    )
                    save_movie_not_found(
                        movie,
                        output_root,
                        logger,
                        str(error),
                        f"[Movie {index}/{len(movies)}]",
                    )
                except Exception as error:  # noqa: BLE001
                    logger.exception(
                        "[Movie %s/%s] Failed to scrape %s: %s",
                        index,
                        len(movies),
                        normalize_whitespace(movie.get("title")) or "Untitled Movie",
                        error,
                    )

        if args.mode in {"all", "tv"}:
            shows = load_catalog_entries(catalog_root, "tv", logger, args.show_limit)
            if args.show_limit is not None:
                logger.info("Applying TV show limit: %s", args.show_limit)

            for show_index, show in enumerate(shows, start=1):
                try:
                    scrape_tv_show(
                        session,
                        show,
                        output_root,
                        logger,
                        show_index,
                        len(shows),
                        args.episode_limit,
                    )
                    tv_saved += 1
                except LookupError as error:
                    logger.warning("[TV %s/%s] %s", show_index, len(shows), error)
                    missing_payload = build_tv_not_found_payload(show, str(error))
                    missing_output_path = (
                        output_root
                        / "tv_shows"
                        / sanitize_path_part(normalize_whitespace(show.get("title")) or "Untitled Show", "tv_show")
                        / "script_not_found.json"
                    )
                    missing_tv_entries.append(
                        build_missing_script_summary_entry(missing_payload, missing_output_path, output_root)
                    )
                    save_tv_not_found(
                        show,
                        output_root,
                        logger,
                        str(error),
                        f"[TV {show_index}/{len(shows)}]",
                    )
                except Exception as error:  # noqa: BLE001
                    logger.exception(
                        "[TV %s/%s] Failed to scrape %s: %s",
                        show_index,
                        len(shows),
                        normalize_whitespace(show.get("title")) or "Untitled Show",
                        error,
                    )
        save_missing_scripts_summary(output_root, logger, missing_movie_entries, missing_tv_entries)
        save_missing_movies_summary(output_root, logger, missing_movie_entries)
    finally:
        session.close()

    logger.info(
        "Finished catalog-driven scraping. Saved %s movie script(s) and %s TV show collection(s).",
        movie_saved,
        tv_saved,
    )


if __name__ == "__main__":
    main()
