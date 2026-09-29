import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#0a2a4a",
          light: "#14355c",
        },
        "mns-blue": {
          DEFAULT: "#0099da",
          dark: "#0077b3",
        },
        teal: {
          DEFAULT: "#0099da",
          700: "#0077b3",
          800: "#005f8f",
        },
      },
    },
  },
  plugins: [],
};
export default config;
