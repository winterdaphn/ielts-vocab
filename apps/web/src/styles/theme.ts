import { theme, type ThemeConfig } from 'antd';

/**
 * Theme matches the example.html design system — warm cream background with
 * a deep teal accent. Single source of truth for ConfigProvider tokens.
 * Visual polish / class-level overrides live in antd-overrides.scss.
 */
export const ieltsTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#2e6b5c',     // --accent (deep teal)
    colorSuccess: '#2e6b5c',
    colorWarning: '#b58c3e',
    colorError: '#b54848',
    colorBgBase: '#f7f5f0',      // --bg (warm cream)
    colorBgContainer: '#ffffff',
    colorTextBase: '#1f1f1f',    // --text
    colorBorder: '#e8e3da',      // --border
    colorBorderSecondary: '#f0ebe2',
    borderRadius: 10,
    borderRadiusLG: 16,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    fontSize: 15,
    lineHeight: 1.6,
    controlHeight: 40,
  },
  components: {
    Card: {
      borderRadiusLG: 16,
      boxShadowTertiary: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
      paddingLG: 20,
    },
    Button: {
      controlHeight: 40,
      borderRadius: 10,
      fontWeight: 500,
      primaryShadow: 'none',
      defaultShadow: 'none',
    },
    Input: {
      controlHeight: 40,
      borderRadius: 10,
      activeShadow: '0 0 0 2px rgba(46, 107, 92, 0.12)',
    },
    Tabs: {
      horizontalItemPadding: '8px 0',
      titleFontSize: 14,
    },
    Tag: {
      borderRadiusSM: 6,
    },
  },
};

/** CSS variables for legacy global CSS that uses var(--accent) etc. */
export const cssVars = `
  :root {
    --bg: #f7f5f0;
    --card: #ffffff;
    --text: #1f1f1f;
    --text-light: #6b6b6b;
    --text-mute: #9a9a9a;
    --border: #e8e3da;
    --border-light: #f0ebe2;
    --accent: #2e6b5c;
    --accent-light: #e8f0ed;
    --accent-hover: #245951;
    --accent-dark: #245951;
    --error: #b54848;
    --error-light: #fae9e9;
    --success: #2e6b5c;
    --success-light: #e6f3ee;
    --warning: #b58c3e;
    --warning-light: #faf2dd;
    --highlight: #f7e9b0;
    --chinese-bg: #f5f1e8;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
    --shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
    --shadow-md: 0 4px 16px rgba(0,0,0,0.08);
    --radius: 10px;
    --radius-sm: 8px;
    --radius-lg: 16px;
  }
`;
