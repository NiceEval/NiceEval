import mixpanel from "mixpanel-browser";

const MIXPANEL_TOKEN = "14c603c0395d0b067171c8cd6ef2c871";

// Autocapture 拿点击/表单一类的通用交互；record_sessions_percent 开会话回放，
// 两者都只在生产构建里跑，本地开发不产生数据也不用挂代理。
export function initAnalytics() {
  if (process.env.NODE_ENV !== "production") return;
  mixpanel.init(MIXPANEL_TOKEN, {
    autocapture: true,
    record_sessions_percent: 100,
    track_pageview: true,
    persistence: "localStorage",
  });
}

export function track(event, props) {
  if (process.env.NODE_ENV !== "production") return;
  mixpanel.track(event, props);
}
