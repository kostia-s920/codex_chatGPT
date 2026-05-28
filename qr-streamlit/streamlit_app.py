from __future__ import annotations

import io
import os
import re
import uuid
from datetime import datetime, timezone
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

import pandas as pd
import qrcode
import streamlit as st
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    func,
    select,
    update,
)
from sqlalchemy.engine import Engine


st.set_page_config(page_title="QR Analytics", page_icon="QR", layout="wide")

metadata = MetaData()

qr_codes = Table(
    "qr_codes",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("slug", String(64), unique=True, nullable=False, index=True),
    Column("title", String(180), nullable=False),
    Column("destination_url", Text, nullable=False),
    Column("utm_source", String(180)),
    Column("utm_medium", String(180)),
    Column("utm_campaign", String(180)),
    Column("utm_term", String(180)),
    Column("utm_content", String(180)),
    Column("is_active", Boolean, nullable=False, default=True),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

scans = Table(
    "scans",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("qr_code_id", Integer, ForeignKey("qr_codes.id"), nullable=False, index=True),
    Column("scanned_at", DateTime(timezone=True), nullable=False, index=True),
    Column("referrer", Text),
    Column("user_agent", Text),
    Column("device", String(80)),
    Column("browser", String(80)),
)


def secret_or_env(name: str, default: str | None = None) -> str | None:
    try:
        return st.secrets.get(name, os.getenv(name, default))
    except Exception:
        return os.getenv(name, default)


@st.cache_resource
def get_engine() -> Engine:
    database_url = secret_or_env("DATABASE_URL")
    if not database_url:
        database_url = "sqlite:///qr_analytics_local.db"

    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    engine = create_engine(database_url, connect_args=connect_args, pool_pre_ping=True)
    metadata.create_all(engine)
    return engine


engine = get_engine()


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


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


def add_utm(destination_url: str, qr: dict) -> str:
    parsed = urlparse(destination_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    for field in ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]:
        value = qr.get(field)
        if value:
            query[field] = value
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


def fetch_qr_codes(search: str = "", status: str = "All") -> pd.DataFrame:
    scan_count = (
        select(scans.c.qr_code_id, func.count(scans.c.id).label("scans_count"))
        .group_by(scans.c.qr_code_id)
        .subquery()
    )

    statement = (
        select(
            qr_codes,
            func.coalesce(scan_count.c.scans_count, 0).label("scans_count"),
        )
        .outerjoin(scan_count, scan_count.c.qr_code_id == qr_codes.c.id)
        .order_by(qr_codes.c.created_at.desc())
    )

    with engine.begin() as conn:
        rows = conn.execute(statement).mappings().all()

    data = [dict(row) for row in rows]
    frame = pd.DataFrame(data)
    if frame.empty:
        return frame

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

    return frame.reset_index(drop=True)


def create_qr(payload: dict) -> None:
    timestamp = now_utc()
    slug_base = clean_slug(payload["title"])
    slug = slug_base

    with engine.begin() as conn:
        existing_slugs = {
            row[0]
            for row in conn.execute(select(qr_codes.c.slug).where(qr_codes.c.slug.like(f"{slug_base}%"))).all()
        }
        if slug in existing_slugs:
            slug = f"{slug_base}-{uuid.uuid4().hex[:6]}"

        conn.execute(
            qr_codes.insert().values(
                slug=slug,
                title=payload["title"],
                destination_url=payload["destination_url"],
                utm_source=payload.get("utm_source") or None,
                utm_medium=payload.get("utm_medium") or None,
                utm_campaign=payload.get("utm_campaign") or None,
                utm_term=payload.get("utm_term") or None,
                utm_content=payload.get("utm_content") or None,
                is_active=payload["is_active"],
                created_at=timestamp,
                updated_at=timestamp,
            )
        )


def update_qr(qr_id: int, payload: dict) -> None:
    with engine.begin() as conn:
        conn.execute(
            update(qr_codes)
            .where(qr_codes.c.id == qr_id)
            .values(
                title=payload["title"],
                destination_url=payload["destination_url"],
                utm_source=payload.get("utm_source") or None,
                utm_medium=payload.get("utm_medium") or None,
                utm_campaign=payload.get("utm_campaign") or None,
                utm_term=payload.get("utm_term") or None,
                utm_content=payload.get("utm_content") or None,
                is_active=payload["is_active"],
                updated_at=now_utc(),
            )
        )


def record_scan_and_redirect(slug: str) -> None:
    already_recorded = st.session_state.get("recorded_scan_slug") == slug

    with engine.begin() as conn:
        qr = conn.execute(select(qr_codes).where(qr_codes.c.slug == slug)).mappings().first()

        if not qr:
            st.error("QR-код не знайдено.")
            return

        if not qr["is_active"]:
            st.warning("Цей QR-код вимкнений.")
            return

        if not already_recorded:
            user_agent = st.query_params.get("ua")
            referrer = st.query_params.get("ref")
            conn.execute(
                scans.insert().values(
                    qr_code_id=qr["id"],
                    scanned_at=now_utc(),
                    referrer=referrer,
                    user_agent=user_agent,
                    device=detect_device(user_agent),
                    browser=detect_browser(user_agent),
                )
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
    with engine.begin() as conn:
        recent_rows = conn.execute(
            select(
                scans.c.id,
                scans.c.scanned_at,
                scans.c.referrer,
                scans.c.device,
                scans.c.browser,
                qr_codes.c.title,
                qr_codes.c.slug,
            )
            .join(qr_codes, qr_codes.c.id == scans.c.qr_code_id)
            .order_by(scans.c.scanned_at.desc())
            .limit(50)
        ).mappings().all()

        top_rows = conn.execute(
            select(
                qr_codes.c.title,
                qr_codes.c.slug,
                qr_codes.c.is_active,
                func.count(scans.c.id).label("scans"),
            )
            .outerjoin(scans, scans.c.qr_code_id == qr_codes.c.id)
            .group_by(qr_codes.c.id)
            .order_by(func.count(scans.c.id).desc())
            .limit(20)
        ).mappings().all()

        day_rows = conn.execute(
            select(
                func.date(scans.c.scanned_at).label("day"),
                func.count(scans.c.id).label("scans"),
            )
            .group_by(func.date(scans.c.scanned_at))
            .order_by(func.date(scans.c.scanned_at))
        ).mappings().all()

    return pd.DataFrame(recent_rows), pd.DataFrame(top_rows), pd.DataFrame(day_rows)


def render_admin() -> None:
    st.title("QR Analytics")
    st.caption("Internal MVP for long-lived QR codes with persistent scan analytics")

    recent_df, top_df, day_df = analytics_frames()
    codes_df = fetch_qr_codes()

    metric_cols = st.columns(4)
    metric_cols[0].metric("QR codes", len(codes_df))
    metric_cols[1].metric("Active", int(codes_df["is_active"].sum()) if not codes_df.empty else 0)
    metric_cols[2].metric("Total scans", len(recent_df))
    metric_cols[3].metric("Best QR", top_df.iloc[0]["title"] if not top_df.empty and top_df.iloc[0]["scans"] > 0 else "-")

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
                    top_line[2].write("Active" if qr["is_active"] else "Disabled")

                    track_url = tracking_url(qr["slug"])
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
                        st.session_state["edit_qr_id"] = int(qr["id"])
                        st.rerun()

    with tab_new:
        editable_df = fetch_qr_codes()
        selected_id = st.session_state.get("edit_qr_id")
        selected = None
        if selected_id and not editable_df.empty:
            rows = editable_df[editable_df["id"] == selected_id]
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
            is_active = col6.toggle("Active", value=bool(selected["is_active"]) if selected else True)
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
                    update_qr(int(selected["id"]), payload)
                    st.success("QR оновлено.")
                else:
                    create_qr(payload)
                    st.success("QR створено.")
                st.session_state.pop("edit_qr_id", None)
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
