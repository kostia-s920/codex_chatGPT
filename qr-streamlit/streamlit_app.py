from __future__ import annotations

import io
import json
import os
import re
import uuid
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import gspread
import pandas as pd
import qrcode
import streamlit as st
from google.oauth2.service_account import Credentials


st.set_page_config(page_title="QR Analytics", page_icon="QR", layout="wide")

QR_SHEET = "qr_codes"
SCANS_SHEET = "scans"

QR_HEADERS = [
    "id",
    "slug",
    "title",
    "destination_url",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "is_active",
    "created_at",
    "updated_at",
]

SCAN_HEADERS = [
    "id",
    "qr_code_id",
    "slug",
    "scanned_at",
    "referrer",
    "user_agent",
    "device",
    "browser",
]


def secret_or_env(name: str, default: str | None = None) -> str | None:
    try:
        value = st.secrets.get(name)
        return str(value) if value is not None else os.getenv(name, default)
    except Exception:
        return os.getenv(name, default)


def load_service_account_info() -> dict | None:
    try:
        if "google_service_account" in st.secrets:
            return dict(st.secrets["google_service_account"])
    except Exception:
        pass

    json_text = secret_or_env("GOOGLE_SERVICE_ACCOUNT_JSON")
    if json_text:
        return json.loads(json_text)

    json_file = secret_or_env("GOOGLE_SERVICE_ACCOUNT_FILE")
    if json_file and os.path.exists(json_file):
        with open(json_file, "r", encoding="utf-8") as file:
            return json.load(file)

    return None


@st.cache_resource
def open_spreadsheet():
    sheet_id = secret_or_env("GOOGLE_SHEET_ID")
    service_account_info = load_service_account_info()
    if not sheet_id or not service_account_info:
        return None

    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    credentials = Credentials.from_service_account_info(service_account_info, scopes=scopes)
    client = gspread.authorize(credentials)
    spreadsheet = client.open_by_key(sheet_id)
    ensure_worksheet(spreadsheet, QR_SHEET, QR_HEADERS)
    ensure_worksheet(spreadsheet, SCANS_SHEET, SCAN_HEADERS)
    return spreadsheet


def ensure_worksheet(spreadsheet, title: str, headers: list[str]):
    try:
        worksheet = spreadsheet.worksheet(title)
    except gspread.WorksheetNotFound:
        worksheet = spreadsheet.add_worksheet(title=title, rows=1000, cols=len(headers))

    first_row = worksheet.row_values(1)
    if first_row != headers:
        worksheet.update("A1", [headers])
    return worksheet


def sheet_or_stop():
    spreadsheet = open_spreadsheet()
    if spreadsheet:
        return spreadsheet

    st.error("Google Sheets не налаштовано.")
    st.markdown(
        """
        Потрібно додати `GOOGLE_SHEET_ID` і credentials сервісного акаунта в Streamlit Secrets
        або локально вказати `GOOGLE_SERVICE_ACCOUNT_FILE`.
        """
    )
    st.stop()


def worksheet(title: str):
    return sheet_or_stop().worksheet(title)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def app_base_url() -> str:
    configured = secret_or_env("PUBLIC_BASE_URL")
    if configured:
        return configured.rstrip("/")
    return "http://localhost:8501"


def clean_slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip().lower()).strip("-")
    return slug[:48] or uuid.uuid4().hex[:10]


def validate_url(value: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("URL має починатися з http:// або https://")


def add_utm(destination_url: str, qr: dict | pd.Series) -> str:
    parsed = urlparse(str(destination_url))
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    for field in ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]:
        value = qr.get(field)
        if value:
            query[field] = str(value)
        else:
            query.pop(field, None)
    return urlunparse(parsed._replace(query=urlencode(query)))


def tracking_url(slug: str) -> str:
    return f"{app_base_url()}/?scan={slug}"


def detect_device(user_agent: str | None) -> str:
    ua = (user_agent or "").lower()
    if "ipad" in ua or "tablet" in ua:
        return "Tablet"
    if "mobile" in ua or "iphone" in ua or "android" in ua:
        return "Mobile"
    if ua:
        return "Desktop"
    return "Unknown"


def detect_browser(user_agent: str | None) -> str:
    ua = user_agent or ""
    if "Edg/" in ua:
        return "Edge"
    if "Chrome" in ua or "CriOS" in ua:
        return "Chrome"
    if "Safari" in ua:
        return "Safari"
    if "Firefox" in ua or "FxiOS" in ua:
        return "Firefox"
    return "Unknown"


def qr_image_bytes(url: str) -> bytes:
    image = qrcode.make(url)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def normalize_bool(value) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes", "active"}


def read_sheet_dataframe(title: str, headers: list[str]) -> pd.DataFrame:
    rows = worksheet(title).get_all_records(expected_headers=headers)
    frame = pd.DataFrame(rows)
    if frame.empty:
        return pd.DataFrame(columns=headers)

    for header in headers:
        if header not in frame.columns:
            frame[header] = ""

    return frame[headers].fillna("")


def fetch_qr_codes(search: str = "", status: str = "All") -> pd.DataFrame:
    frame = read_sheet_dataframe(QR_SHEET, QR_HEADERS)
    scans_frame = read_sheet_dataframe(SCANS_SHEET, SCAN_HEADERS)

    if frame.empty:
        return frame.assign(scans_count=pd.Series(dtype=int))

    frame["is_active"] = frame["is_active"].apply(normalize_bool)
    if scans_frame.empty:
        frame["scans_count"] = 0
    else:
        counts = scans_frame.groupby("qr_code_id").size().rename("scans_count")
        frame = frame.merge(counts, how="left", left_on="id", right_index=True)
        frame["scans_count"] = frame["scans_count"].fillna(0).astype(int)

    if search:
        needle = search.lower()
        mask = (
            frame["title"].str.lower().str.contains(needle, na=False)
            | frame["slug"].str.lower().str.contains(needle, na=False)
            | frame["destination_url"].str.lower().str.contains(needle, na=False)
        )
        frame = frame[mask]

    if status == "Active":
        frame = frame[frame["is_active"] == True]
    elif status == "Disabled":
        frame = frame[frame["is_active"] == False]

    return frame.sort_values("created_at", ascending=False).reset_index(drop=True)


def row_values_from_qr(qr: dict) -> list:
    return [
        qr.get("id", ""),
        qr.get("slug", ""),
        qr.get("title", ""),
        qr.get("destination_url", ""),
        qr.get("utm_source", ""),
        qr.get("utm_medium", ""),
        qr.get("utm_campaign", ""),
        qr.get("utm_term", ""),
        qr.get("utm_content", ""),
        "TRUE" if qr.get("is_active") else "FALSE",
        qr.get("created_at", ""),
        qr.get("updated_at", ""),
    ]


def create_qr(payload: dict) -> None:
    codes = fetch_qr_codes()
    slug_base = clean_slug(payload["title"])
    slug = slug_base

    if not codes.empty and slug in set(codes["slug"].astype(str)):
        slug = f"{slug_base}-{uuid.uuid4().hex[:6]}"

    timestamp = now_iso()
    qr = {
        "id": uuid.uuid4().hex,
        "slug": slug,
        "title": payload["title"],
        "destination_url": payload["destination_url"],
        "utm_source": payload.get("utm_source", ""),
        "utm_medium": payload.get("utm_medium", ""),
        "utm_campaign": payload.get("utm_campaign", ""),
        "utm_term": payload.get("utm_term", ""),
        "utm_content": payload.get("utm_content", ""),
        "is_active": payload["is_active"],
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    worksheet(QR_SHEET).append_row(row_values_from_qr(qr), value_input_option="USER_ENTERED")


def update_qr(qr_id: str, payload: dict) -> None:
    ws = worksheet(QR_SHEET)
    records = ws.get_all_records(expected_headers=QR_HEADERS)
    for index, record in enumerate(records, start=2):
        if str(record.get("id")) == str(qr_id):
            updated = {
                **record,
                "title": payload["title"],
                "destination_url": payload["destination_url"],
                "utm_source": payload.get("utm_source", ""),
                "utm_medium": payload.get("utm_medium", ""),
                "utm_campaign": payload.get("utm_campaign", ""),
                "utm_term": payload.get("utm_term", ""),
                "utm_content": payload.get("utm_content", ""),
                "is_active": payload["is_active"],
                "updated_at": now_iso(),
            }
            ws.update(f"A{index}:L{index}", [row_values_from_qr(updated)])
            return
    raise ValueError("QR не знайдено")


def record_scan_and_redirect(slug: str) -> None:
    already_recorded = st.session_state.get("recorded_scan_slug") == slug
    codes = fetch_qr_codes()
    rows = codes[codes["slug"].astype(str) == str(slug)]

    if rows.empty:
        st.error("QR-код не знайдено.")
        return

    qr = rows.iloc[0].to_dict()
    if not normalize_bool(qr["is_active"]):
        st.warning("Цей QR-код вимкнений.")
        return

    if not already_recorded:
        user_agent = st.query_params.get("ua")
        referrer = st.query_params.get("ref")
        worksheet(SCANS_SHEET).append_row(
            [
                uuid.uuid4().hex,
                qr["id"],
                qr["slug"],
                now_iso(),
                referrer or "",
                user_agent or "",
                detect_device(user_agent),
                detect_browser(user_agent),
            ],
            value_input_option="USER_ENTERED",
        )
        st.session_state["recorded_scan_slug"] = slug

    final_url = add_utm(qr["destination_url"], qr)
    st.markdown(
        f"""
        <meta http-equiv="refresh" content="0; url={final_url}">
        <script>window.location.replace({final_url!r});</script>
        """,
        unsafe_allow_html=True,
    )
    st.info("Redirecting...")
    st.link_button("Open link", final_url)


def analytics_frames() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    codes = fetch_qr_codes()
    scans = read_sheet_dataframe(SCANS_SHEET, SCAN_HEADERS)

    if scans.empty:
        recent = pd.DataFrame(columns=["id", "scanned_at", "referrer", "device", "browser", "title", "slug"])
        top = codes[["title", "slug", "is_active", "scans_count"]] if not codes.empty else pd.DataFrame(columns=["title", "slug", "is_active", "scans_count"])
        days = pd.DataFrame(columns=["day", "scans"])
        return recent, top.rename(columns={"scans_count": "scans"}), days

    recent = scans.merge(
        codes[["id", "title", "slug"]],
        how="left",
        left_on="qr_code_id",
        right_on="id",
        suffixes=("", "_qr"),
    )
    recent = recent[["id", "scanned_at", "referrer", "device", "browser", "title", "slug"]]
    recent = recent.sort_values("scanned_at", ascending=False).head(50)

    top = codes[["title", "slug", "is_active", "scans_count"]].rename(columns={"scans_count": "scans"})
    top = top.sort_values("scans", ascending=False).head(20)

    scans["day"] = pd.to_datetime(scans["scanned_at"], errors="coerce").dt.date.astype(str)
    days = scans.groupby("day").size().reset_index(name="scans").sort_values("day")

    return recent, top, days


def render_admin() -> None:
    st.title("QR Analytics")
    st.caption("Google Sheets storage for long-lived QR codes and scan analytics")

    recent_df, top_df, day_df = analytics_frames()
    codes_df = fetch_qr_codes()

    metric_cols = st.columns(4)
    metric_cols[0].metric("QR codes", len(codes_df))
    metric_cols[1].metric("Active", int(codes_df["is_active"].sum()) if not codes_df.empty else 0)
    metric_cols[2].metric("Total scans", len(recent_df))
    metric_cols[3].metric("Best QR", top_df.iloc[0]["title"] if not top_df.empty and int(top_df.iloc[0]["scans"]) > 0 else "-")

    tab_codes, tab_new, tab_stats = st.tabs(["QR codes", "Create / edit", "Analytics"])

    with tab_codes:
        left, right = st.columns([2, 1])
        search = left.text_input("Search", placeholder="Title, slug, URL")
        status = right.selectbox("Status", ["All", "Active", "Disabled"])
        filtered = fetch_qr_codes(search, status)

        if filtered.empty:
            st.info("Поки немає QR-кодів.")
        else:
            for _, qr in filtered.iterrows():
                with st.container(border=True):
                    top_line = st.columns([3, 1, 1])
                    top_line[0].subheader(qr["title"])
                    top_line[1].metric("Scans", int(qr["scans_count"]))
                    top_line[2].write("Active" if normalize_bool(qr["is_active"]) else "Disabled")

                    track_url = tracking_url(str(qr["slug"]))
                    st.code(track_url, language="text")
                    st.caption(qr["destination_url"])

                    qr_cols = st.columns([1, 2, 2])
                    qr_cols[0].image(qr_image_bytes(track_url), width=180)
                    qr_cols[1].download_button(
                        "Download QR PNG",
                        data=qr_image_bytes(track_url),
                        file_name=f"{qr['slug']}.png",
                        mime="image/png",
                        key=f"download-{qr['id']}",
                    )
                    if qr_cols[2].button("Edit this QR", key=f"edit-{qr['id']}"):
                        st.session_state["edit_qr_id"] = str(qr["id"])
                        st.rerun()

    with tab_new:
        editable_df = fetch_qr_codes()
        selected_id = st.session_state.get("edit_qr_id")
        selected = None
        if selected_id and not editable_df.empty:
            rows = editable_df[editable_df["id"].astype(str) == str(selected_id)]
            if not rows.empty:
                selected = rows.iloc[0].to_dict()

        mode = "Edit QR" if selected else "Create QR"
        st.subheader(mode)

        with st.form("qr_form"):
            title = st.text_input("Title", value=selected["title"] if selected else "")
            destination_url = st.text_input("Final URL", value=selected["destination_url"] if selected else "")
            col1, col2, col3 = st.columns(3)
            utm_source = col1.text_input("UTM source", value=(selected.get("utm_source") or "qr") if selected else "qr")
            utm_medium = col2.text_input("UTM medium", value=(selected.get("utm_medium") or "") if selected else "")
            utm_campaign = col3.text_input("UTM campaign", value=(selected.get("utm_campaign") or "") if selected else "")
            col4, col5, col6 = st.columns(3)
            utm_term = col4.text_input("UTM term", value=(selected.get("utm_term") or "") if selected else "")
            utm_content = col5.text_input("UTM content", value=(selected.get("utm_content") or "") if selected else "")
            is_active = col6.toggle("Active", value=normalize_bool(selected["is_active"]) if selected else True)
            submitted = st.form_submit_button("Save")

        if submitted:
            try:
                title = title.strip()
                destination_url = destination_url.strip()
                if not title:
                    raise ValueError("Назва обов'язкова")
                validate_url(destination_url)
                payload = {
                    "title": title,
                    "destination_url": destination_url,
                    "utm_source": utm_source.strip(),
                    "utm_medium": utm_medium.strip(),
                    "utm_campaign": utm_campaign.strip(),
                    "utm_term": utm_term.strip(),
                    "utm_content": utm_content.strip(),
                    "is_active": is_active,
                }
                if selected:
                    update_qr(str(selected["id"]), payload)
                    st.success("QR оновлено.")
                else:
                    create_qr(payload)
                    st.success("QR створено.")
                st.session_state.pop("edit_qr_id", None)
                st.cache_data.clear()
                st.rerun()
            except ValueError as exc:
                st.error(str(exc))

        if selected and st.button("Cancel editing"):
            st.session_state.pop("edit_qr_id", None)
            st.rerun()

    with tab_stats:
        st.subheader("Scans by day")
        if day_df.empty:
            st.info("Поки немає сканів.")
        else:
            st.bar_chart(day_df.set_index("day")["scans"])

        col_left, col_right = st.columns(2)
        with col_left:
            st.subheader("Top QR codes")
            st.dataframe(top_df, use_container_width=True, hide_index=True)
        with col_right:
            st.subheader("Recent scans")
            st.dataframe(recent_df, use_container_width=True, hide_index=True)


scan_slug = st.query_params.get("scan")
if scan_slug:
    record_scan_and_redirect(scan_slug)
else:
    render_admin()
