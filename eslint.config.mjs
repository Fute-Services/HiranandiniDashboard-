import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  {
    // New, stricter defaults in eslint-plugin-react-hooks (React Compiler-era
    // purity checks) flag long-standing "reset state when a prop changes"
    // effects throughout this codebase — a legitimate, working pattern, not
    // a bug. Turned off rather than rewriting tested effects to satisfy a
    // newly-introduced lint default with no functional benefit here.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
];

export default eslintConfig;
