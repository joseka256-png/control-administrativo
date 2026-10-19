# Control Administrativo

Sistema web para el manejo administrativo de una empresa de servicios en Costa Rica: cobros a clientes, planilla con cargas sociales, turnos, gastos e informes.

## Módulos

- **Clientes y cobros**: cuotas diarias, semanales, quincenales y mensuales. Calcula saldo, próximo cobro y estado (al día, pendiente, atrasado) a partir de la fecha de inicio y los pagos registrados.
- **Planilla**: empleados con pago semanal, quincenal o mensual; salario fijo o por hora. Horas extra desde los turnos, bonos y rebajos, CCSS obrera y patronal, INS y provisión de aguinaldo y vacaciones. Exporta CSV.
- **Turnos**: calendario semanal por empleado, aviso de horas extra, copiar semana anterior.
- **Gastos**: por categoría y mes.
- **Informes**: estado de resultados mensual y tendencia de 6 meses. Exporta CSV.
- **Ajustes**: tasas, jornada, respaldo e importación de datos, datos de ejemplo.

## Tasas por defecto (vigentes desde el 1 de enero de 2026)

| Concepto | % |
|---|---|
| CCSS obrera (SEM 5,50 + IVM 4,33 + Banco Popular 1) | 10,83 |
| CCSS patronal + LPT | 26,83 |
| INS riesgos del trabajo | Configurable según póliza |
| Provisión aguinaldo | 8,33 |
| Provisión vacaciones | 4,17 |

No calcula el impuesto sobre la renta de salarios.

## Reglas de cálculo

- **Cobros**: un cobro al inicio de cada período desde la fecha de inicio del cliente (diario: cada día; semanal: cada 7 días; quincenal: cada 15 días; mensual: mismo día de cada mes). Saldo = cuotas vencidas a hoy − pagos.
- **Salario fijo**: semanal = mensual × 12 ÷ 52; quincenal = mensual ÷ 2. Valor hora = mensual ÷ 240.
- **Horas extra**: lo que pase de la jornada diaria (8 h por defecto) se paga a 1,5×.
- **Bruto** = base + extras + bonos. **Neto** = bruto − CCSS obrera − rebajos. **Costo** = bruto + patronal + INS.

## Almacenamiento

Por ahora los datos se guardan en el navegador (`localStorage`, clave `ca_db_v1`). Cada computadora y navegador tiene sus propios datos, así que conviene descargar respaldos desde **Ajustes → Respaldo de datos**.

La capa de datos (`localDB()` en `js/app.js`) usa la misma forma que Firestore v8 (`collection().doc().set()`, `onSnapshot`), así que pasar a Firebase para compartir datos entre usuarios implica sobre todo cambiar ese adaptador y agregar inicio de sesión.

## Estructura

```
index.html      Estructura de la página
css/styles.css  Estilos (tema claro y oscuro)
js/app.js       Lógica, vistas y almacenamiento
```

Sin dependencias ni compilación: se publica tal cual en GitHub Pages (Settings → Pages → Deploy from a branch → `main` / root).

## Desarrollo local

```bash
python3 -m http.server 8000
# abrir http://localhost:8000
```
