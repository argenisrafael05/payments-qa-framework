# payments-qa-framework

Un framework para automatizar las pruebas de un orquestador de pagos. El pago se programa una sola vez, y cada forma de pagar nada más dice qué usa. Un súper, un banco y una wallet, que no trabajan igual, comparten una misma base de casos, con el mismo código.

Lo que importa aquí es cómo está armado.

## El simulador: PayRef

Un framework necesita algo que probar, y no puede ser un sistema real. Por eso PayRef vive en este repo. Es un orquestador de pagos inventado, con sus nombres, sus contratos y sus datos: conecta al merchant, que necesita cobrar, con quien le cobra al cliente.

Todo gira alrededor de la referencia de pago. El merchant la crea, y el cliente la paga donde prefiera. Puede ser única o recurrente, de monto fijo o libre, con fecha de vencimiento o sin ella, y eso da 8 tipos. Lo interesante es que cada forma de pagar le llega distinto a PayRef:

| Payment method | Cómo paga                                                       | Lo que lo hace distinto                                      |
| -------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| El súper       | Manda la solicitud y el aviso en una sola llamada               | Consulta la referencia antes de cobrar                       |
| El banco       | Manda la solicitud, y después el aviso                          | Tiene una ventana de 2 minutos para reversar el pago         |
| La wallet      | El merchant le pide un QR, y ella avisa del pago con un webhook | Firma lo que manda, no tiene token y habla su propio formato |

Comparten reglas en común, como la credencial, que la referencia exista, que siga vigente y que el monto sea válido, pero cada uno tiene sus particularidades. El banco protege su pago mientras corre la ventana, y la wallet vuelve a validar todo cuando llega su webhook. Cada rechazo tiene su código y viaja con un 200, así que un 200 no quiere decir que el pago pasó.

Hay dos regiones, México y Sudamérica, que se parecen pero tienen sus diferencias, y cada una tiene su propia base. La wallet también es simulada: otro proceso aparte, con su API, que hace el QR y le manda su webhook a PayRef.

PayRef tiene dos versiones: la 1.1 está bien, y la 1.0 llega con 8 bugs, como llegaría un release.

## Cómo se abstrajo el framework

El problema de fondo es que los métodos de pago cambian mucho: por su tipo, por su región o simplemente porque cada uno trabaja distinto. Este framework no pelea con esas diferencias. Las vuelve datos, y lo que no cambia se programa una sola vez. Así, lo que en otro lado sería un problema, aquí es una línea de config:

- Integrar un método de pago nuevo es una configuración.
- Agregar un caso es escribir un JSON, sin programar.
- Escala sin copiar: un caso corre en todas las integraciones que lo pueden hacer.
- Se mantiene fácil: el flujo, el juez y la evidencia viven en un solo lugar, así que un cambio se hace una vez.

### Una integración es un JSON

Así entró el banco, sin una línea de código propia:

```json
{
  "id": "bank",
  "name": "Bank",
  "region": "sa",
  "contract": "standard",
  "notice": "separate",
  "inquiry": false,
  "paymentMethod": { "id": "bank", "keyEnv": "SA_BANK_KEY" },
  "amountLimits": { "min": 10, "max": 50000 },
  "reversalWindow": { "minutes": 2 },
  "merchant": { "id": "merchant-sa-1", "keyEnv": "SA_MERCHANT_1_KEY" },
  "otherMerchants": {
    "another-merchant": { "id": "merchant-sa-2", "keyEnv": "SA_MERCHANT_2_KEY" }
  }
}
```

`notice` dice cómo llega el aviso, junto con la solicitud, por separado o por webhook, y con eso el framework arma el flujo. Su ventana de reverso es una línea: quien la prende recibe sus casos con la duración que traiga. El paso a paso está en [cómo agregar una integración o un caso](docs/adding-an-integration.md).

### Un caso es un JSON

Dice de dónde parte, adónde llega y qué espera ahí. No trae ni una aserción:

```json
{
  "id": "F07-03",
  "title": "The reversal at the end of the window gets R-107, and the payment is confirmed",
  "flow": "transition",
  "reference": { "type": ["single", "recurring"], "amountType": "fixed" },
  "from": "pending",
  "after": "window-end",
  "objective": { "step": "reversal", "expect": "R-107" },
  "tags": ["hu-10"]
}
```

Una lista saca una prueba por cada valor. Y lo que cambia por región se escribe por lo que es, como `window-end` o `extra-decimal`, y el framework pone el número de cada una.

### Eliges qué correr

Los casos salen de una base común, y el framework los cruza con cada integración: cada uno corre donde se puede hacer. Son 56 casos y 451 pruebas, y puedes correr todo, una integración, una familia o un solo caso. Lo que no le aplica a una integración no desaparece: sale como No ejecutado, con su razón, como "Bank has no webhook".

### Lo demás no sabe de ninguna integración

| Pieza                  | Qué hace                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Los flujos y los pasos | El pago, escrito una vez. La config escoge la variante                                                                                      |
| Las plantillas         | Cómo leer cada API: en qué campo viene el código, qué pide un éxito y un diccionario que traduce sus códigos a los de PayRef                |
| El juez                | Lee cada respuesta y dice si es la que el caso esperaba. Decide el código de negocio, no el 200, y revisa que no se fuguen datos internos   |
| La revisión de la base | Tiene la última palabra: los movimientos tienen que cuadrar con lo que el caso esperaba y la API confirmó. Un cobro doble falla ahí también |
| La evidencia           | Guarda cada paso, con las credenciales ocultas                                                                                              |
| El reporte             | Se arma con lo que guardó la corrida, y deja auditar cada caso hasta sus peticiones                                                         |

Por eso la wallet, con su contrato distinto, solo trajo su cliente y su traducción. Su webhook se prueba de dos formas, firmado por el framework o mandado por la wallet simulada, para no depender de que el tercero esté listo.

### Cómo se empaquetó

```text
framework/
  engine/        el juez, el runner, la evidencia y el reporte. No sabe de pagos
  payments/      el catálogo, los flujos, los pasos, los clientes y las revisiones de la base
  cases/base/    los casos, un archivo por familia
  integrations/  una carpeta por integración, con su config
payref/          el simulador, con sus dos versiones
wallet-sim/      la wallet simulada, un tercero aparte
tests/           las pruebas del framework y el spec que corre los casos
tools/           lo que hay detrás de npm test y npm run report
docs/            requerimientos, análisis de pruebas, matriz de casos, el paso a paso y el resumen de cada fase
```

El framework nunca importa el código de PayRef. Le habla por HTTP y lee su base con un usuario que solo puede leer, y una regla de lint lo cuida.

## Por qué es rápido

Rápido para crecer:

- Una integración nueva es config de los dos lados, y entra con todo el catálogo.
- Un caso nuevo es un JSON y su fila en la matriz.
- Un error de dedo truena al cargar, antes de correr nada, y dice qué archivo y qué campo.

Rápido para correr:

- La ventana del banco se prueba justo en su orilla, un segundo antes de cerrar y al cerrar, sin esperar 2 minutos. PayRef toma la hora de cada petición de un header, solo en modo de pruebas.
- Ninguna prueba duerme. Lo que llega después, como el webhook, se espera preguntando con un máximo.
- Una integración tarda de 2 a 17 segundos en esta máquina.
- Las 166 pruebas del propio framework corren en menos de un segundo, sin PayRef y sin Docker.

## Cómo se puso a prueba

Mientras se construyó, el framework se puso a prueba para verlo fallar. Se rompieron a propósito 55 piezas suyas, una a la vez, y cada una hizo fallar la prueba que le tocaba. También se rompió PayRef y se cambió lo esperado en los casos, para ver que cada falla dijera qué esperaba y qué llegó.

El framework no sabe contra qué versión corre: la versión solo sirve para prender ese PayRef y ponerla en el reporte.

## Lista de bugs

La 1.0 de PayRef trae estos 8. Contra ella fallan 17 pruebas en el súper, 21 en el banco y 33 en la wallet, y contra la 1.1 no falla ninguna.

| El bug en la 1.0                                      | Lo atrapa                                           | Falla en                                 |
| ----------------------------------------------------- | --------------------------------------------------- | ---------------------------------------- |
| Un aviso repetido registra otro pago                  | F05-02, el aviso repetido de una recurrente         | La respuesta y la base                   |
| Un monto con decimales de más se redondea y se acepta | F03-05, un decimal más de los que permite la región | La respuesta, y la base donde ya se pagó |
| La referencia vence un día antes                      | F06-01 y F06-03, el último segundo de su día        | La respuesta                             |
| Los errores traen el stacktrace                       | F11-05 y F10-07, lo que PayRef rechaza con un 400   | La respuesta                             |
| Acepta un webhook con firma mala                      | F08-05, firmado con una llave que no conoce         | La respuesta y la base                   |
| Un webhook tarde no revisa el vencimiento             | F08-01, el webhook de una referencia ya vencida     | La respuesta y la base                   |
| El puente le dice a la wallet que aceptó un rechazo   | F08-02, cuando el framework manda el webhook        | La respuesta                             |
| El banco reversa con la ventana ya cerrada            | F07-03, el reverso justo al cerrar                  | La respuesta y la base                   |

## Cómo correrlo

Necesitas Node 24 (la versión está en `.nvmrc`) y Docker Desktop prendido.

```bash
nvm use
npm install
npm test           # corre contra el simulador sin bugs
npm run test:bugs  # corre contra el simulador con bugs
```

No hay `.env` que copiar. La primera vez baja la imagen de MySQL y tarda más. Después, `npm test` prende la base si está apagada, corre las tres integraciones una tras otra, y prende y apaga PayRef y la wallet simulada. Antes del primer caso, una revisión rápida confirma que Docker, la base y los puertos estén bien. Si falta algo, la corrida no empieza y dice qué.

| Comando                         | Qué hace                                                  |
| ------------------------------- | --------------------------------------------------------- |
| `npm test`                      | Corre las tres integraciones contra el simulador sin bugs |
| `npm run test:bugs`             | Lo mismo contra el simulador con bugs                     |
| `npm test -- bank`              | Corre solo una integración                                |
| `npm test -- wallet --grep F08` | Corre solo algunos casos, con opciones de Playwright      |
| `npm run report`                | Vuelve a escribir el reporte de la última corrida         |
| `npm run verify`                | Formato, tipos, lint y las pruebas del framework          |
| `npm run db:down`               | Apaga la base                                             |

## El reporte

Cada corrida deja su carpeta en `artifacts/runs/`, y la consola dice dónde quedó su reporte. Primero va el resumen: cuántas pruebas se aprueban, y cuántas salieron Correcto, Fallido, No concluido o No ejecutado. Después, cada caso se abre hasta sus pasos, sus revisiones de la base y las peticiones que viajaron.

Son cuatro resultados porque dos no alcanzan. Fallido quiere decir que PayRef hizo otra cosa. No concluido, que no se pudo probar, como un timeout. No ejecutado trae su razón. Y un Correcto con la evidencia incompleta no se aprueba, porque una prueba en verde que nadie puede auditar no demuestra mucho.

## Lo que sigue

- Un pipeline de CI con GitHub Actions.
- Un set de pruebas de contrato para las APIs de PayRef, aparte de los casos de negocio.
- Un adaptador: un payment method con contrato propio, detrás de otro puente.
- Mandar los resultados a TestRail.

## Docs

- [Requerimientos](docs/requirements.md)
- [Análisis de pruebas](docs/test-analysis.md)
- [Matriz de casos](docs/test-matrix.md)
- [Cómo agregar una integración o un caso](docs/adding-an-integration.md)
- [Resumen de cada fase](docs/phase-summaries.md)
