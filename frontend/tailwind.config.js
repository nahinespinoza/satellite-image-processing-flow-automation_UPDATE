/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  // preflight desactivado: el resto de la app (ProcessorUI.css, index.css, Leaflet)
  // ya trae sus propios estilos base y Tailwind no debe pisarlos.
  corePlugins: { preflight: false },
  // Las utilidades solo aplican dentro de .gwe (GraphWorkflowEditor) y, al ser
  // más específicas, ganan a las reglas globales de index.css (button, h2...).
  important: ".gwe",
  theme: { extend: {} },
  plugins: [],
};
