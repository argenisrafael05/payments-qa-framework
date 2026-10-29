# Requerimientos de Payments QA Framework

| Versión | Fecha        | Cambio                                                                                                                       |
| ------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 0.1     | Octubre 2026 | Versión inicial                                                                |
| 0.2     | Octubre 2026 | Cambios de la revisión estática y del [análisis de pruebas](test-analysis.md) |

## 1. Visión

Este proyecto es un framework para automatizar las pruebas de un orquestador de pagos. Automatiza lo que un QA hace a mano una y otra vez: crear una referencia, pagarla por cada integración, y revisar que el orquestador aplique bien las reglas y que en la base quede lo que tiene que quedar.

Lo que más importa es cómo está armado. El flujo de pago se programa una sola vez, y cada integración nada más dice qué usa. Así, agregar una integración o un caso nuevo cuesta poco, y el código se puede mantener.

El orquestador que se prueba se llama PayRef. Es un sistema simulado que vive en este mismo repo. Conecta al merchant, que necesita cobrar, con los payment methods que le cobran al cliente: un súper, un banco y una wallet. Lo que los une es la referencia de pago: el merchant la crea y el cliente la paga donde prefiera. PayRef trae bugs sembrados a propósito, para demostrar que las pruebas los atrapan.

Cada corrida genera un reporte de ejecución con el resumen de resultados al inicio. Al abrir cada caso se pueden auditar sus pasos, las comprobaciones y las evidencias. Se conserva también el reporte de Playwright.

## 2. Usuarios

**De lo que construimos (el framework y su reporte)**

| Usuario         | Qué busca                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Equipo de QA    | Automatizar los flujos de pago de cada integración, con sus validaciones, y saber después de cada cambio si todo sigue bien. También agregar integraciones y casos nuevos sin mucho trabajo |
| Líder           | Consultar el resultado y el alcance de la corrida, y revisar los casos con sus evidencias                                                                                                   |
| Revisor técnico | Clonar el repo, correrlo y entender cómo está armado                                                                                                                                        |

**De lo que probamos (PayRef)**

| Usuario                                | Qué busca                                                                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Merchant                               | Necesita cobrar: entra con su propia llave, crea referencias de pago, consulta su estatus, pide el QR o link de la wallet y las cancela cuando ya no aplican                                                             |
| Payment method estándar, como un súper | Consultar la referencia y avisar el pago cuando el cliente ya pagó                                                                                                                                                       |
| Banco, un payment method personalizado | Usa el contrato estándar y en su configuración prende una regla de negocio especial, la ventana de reverso: valida antes de confirmar y puede reversar dentro de la ventana si algo falla. No todos los bancos la tienen |
| Wallet, un payment method digital      | Genera un QR o link para que el cliente pague, y avisa el pago con un webhook firmado                                                                                                                                    |

## 3. Alcance

**Incluye:**

- El framework, que automatiza los flujos de pago de las tres integraciones de punta a punta, con sus casos positivos y negativos. Valida las reglas de negocio más importantes, revisa el efecto de cada pago en la base y cubre también seguridad básica. Está armado para crecer: el flujo se programa una vez, cada integración solo declara su configuración, y después se le pueden sumar pruebas de seguridad, de concurrencia o de performance. Deja evidencia de cada paso, caza los bugs sembrados y genera un reporte de ejecución con resultados y evidencias, además del reporte de Playwright.
- PayRef, el orquestador: la solicitud y el aviso de pago, los 8 tipos de referencia, dos regiones (México y Sudamérica) con sus reglas, los tres payment methods, su modelo de respuesta y 8 bugs sembrados.

**Fuera de alcance por ahora (próximamente):** el CI/CD, la conexión con TestRail, la liquidación al merchant, el adaptador, las otras reglas opcionales (sobremonto, impedir doble pago en la ventana y reintento del aviso), el horario restringido, la conciliación, los payouts, los frontends, las pruebas de concurrencia y de performance, con los límites de peticiones, y las pruebas de contrato de las APIs, como un set aparte de regresión para cuando cambie el core.

**Fuera de alcance, porque no son de PayRef:** los rechazos y las caídas de los terceros, como la wallet. Tienen sus propias políticas, que no controlamos, así que se prueba lo que valida PayRef.

**Restricciones:**

- PayRef vive dentro del repo como una caja negra: el framework le habla por HTTP y lee su base para validar, pero nunca importa su código.
- Todo lo de PayRef es ficticio: sus nombres, sus contratos y sus datos se inventaron para este proyecto.

## 4. Épicas

| Épica                              | Descripción                                                                                                    | Historias                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| E1. El framework de automatización | Lo que construimos: automatizar los flujos de pago y sus validaciones, con una arquitectura que aguante crecer | HU-01 a HU-06, HU-12 y HU-13 |
| E2. PayRef, el orquestador         | Lo que probamos: el merchant, los payment methods y el orquestador que los conecta                             | HU-07 a HU-11                |

## 5. Historias de usuario

Prioridad con MoSCoW: **Must** (obligatoria), **Should** (importante) y **Could** (deseable). Las 13 son Must: sin cualquiera de ellas, el proyecto no demuestra lo que promete. Los IDs no se renumeran: una historia nueva toma el siguiente número libre.

### E1. El framework de automatización

**HU-01 Automatizar los flujos de pago de punta a punta** · Must

Como equipo de QA, quiero que los flujos de pago de cada integración corran solos, de punta a punta, para saber después de cada cambio si todo sigue bien, sin volver a hacer a mano lo de siempre: crear la referencia, pagarla y revisar la base.

- El súper, el banco y la wallet corren sus flujos completos: se crea la referencia, llegan la solicitud y el aviso, el banco también puede reversar y la wallet avisa con su webhook.
- Cada paso dice qué esperaba, qué llegó y si cumplió.
- La base tiene la última palabra: tiene que cuadrar con lo que la API confirmó durante el caso. Cada pago que la API aceptó tiene su movimiento, en el estado que le toca (confirmado, pendiente mientras corre la ventana del banco, o reversado), y un rechazo no agrega ninguno. Si no cuadra, el caso falla.
- La revisión de la base corre al final de cada caso, aunque un paso haya fallado, y su resultado se ve sin cambiar el motivo principal.
- Cada paso deja su evidencia real, sin credenciales a la vista. El que ejecuta guarda lo que se mandó y lo que contestó PayRef, o el error si no hubo respuesta. El que observa guarda lo que leyó de la base y la llamada que disparó la acción, si la hubo.
- Con un solo comando, `npm test`, corren las tres integraciones una por una, cada una como su propia corrida. Corren las tres aunque una falle, y el comando termina con error si algún caso salió Fallido o No concluido.
- También se puede correr una sola integración, un caso con todas sus variaciones o una sola variación, y esa corrida queda aparte de las demás.

**HU-02 Validar las reglas de negocio** · Must

Como equipo de QA, quiero validar las reglas de negocio de cada pago, para atrapar lo que un 200 esconde: un rechazo equivocado, un pago repetido o una regla de región que no se cumple.

- Lo que decide es el código de negocio, no el 200: un caso que espera un rechazo pasa solo si llega justo ese código. Si espera un rechazo técnico, como un 400, un 401 o un 403, también tiene que llegar justo ese.
- Si llega otro código, un 500 o una respuesta que la política no reconoce, el caso falla y dice qué esperaba y qué llegó.
- Un aviso repetido se rechaza, y en la base queda un solo movimiento: en una recurrente con R-106, y en una única con R-102, porque la revisión de ya pagada responde antes.
- Una referencia única que ya se pagó se rechaza, traiga la secuencia que traiga.
- Cada regla de región tiene su caso en la frontera: un código de otro largo, las 23:59 del día en que vence y las 00:00 del día siguiente en la hora de la región, y un monto con un decimal de más.
- Los casos de vencimiento y de la ventana del banco fijan la hora en la petición, así que prueban la frontera exacta sin esperar tiempo real.
- Una respuesta que enseña un stacktrace, SQL o rutas internas hace fallar el caso, aunque traiga el código esperado.

**HU-03 Conectar una integración o agregar un caso sin tocar el flujo** · Must

Como equipo de QA, quiero conectar una integración nueva o agregar un caso nuevo sin tocar el flujo de pago, para que sumar cobertura cueste poco y el código siga limpio.

- El banco entra solo con su configuración, sin código propio: su ventana de reverso es una regla que se prende en su JSON.
- Un caso nuevo es un JSON que dice su flujo, su referencia y su objetivo: el paso donde termina y el código que espera.
- Un caso del catálogo base corre en todas las integraciones que pueden hacerlo, sin copiarlo. Las que no pueden lo enseñan en el reporte como No ejecutado, con su razón.
- Si un eje de la referencia trae una lista, sale una prueba por cada valor.
- Un error de dedo en un caso o en una integración falla al cargar: la corrida no empieza, y el error dice qué archivo y qué campo están mal.
- Una integración con un contrato distinto trae solo su cliente y su traducción. Los flujos, el juez y la evidencia no cambian.

**HU-04 Demostrar que las pruebas sirven** · Must

Como equipo de QA, quiero correr las integraciones contra una versión de PayRef con bugs, para demostrar que las pruebas los atrapan, como pasaría con un release real.

- La versión 1.0 de PayRef trae los 8 bugs sembrados, y la 1.1 viene corregida.
- Contra la 1.1, todos los casos que le tocan a cada integración salen Correcto.
- Contra la 1.0, cada bug hace fallar al menos un caso en la comprobación que le toca, y el reporte lo enseña como Fallido, con su motivo.
- Un timeout o un error del framework no cuentan como bug atrapado.
- Los docs dicen qué caso atrapa cada bug.
- `npm run test:1.0` corre esta demo con un solo comando.

**HU-05 Leer el reporte de la corrida** · Must

Como líder, quiero leer el resumen de cada corrida y abrir cualquier caso hasta su evidencia, para saber qué pasó sin pedírselo a nadie y poder auditarlo.

- Lo primero que se ve es el resumen: el contexto de la corrida (la integración, la región, el ambiente y la versión de PayRef), cuántos casos corrieron y cómo salieron.
- Cada variación de un caso cuenta como un caso en el reporte, con su propio resultado y su evidencia, y se nombra con su id, la integración y lo que varió.
- Cada caso sale con uno de cuatro resultados, con su motivo:
  - Correcto: se cumplieron todas las comprobaciones, también si se esperaba un rechazo.
  - Fallido: una comprobación encontró una diferencia, también un 500 que PayRef sí contestó o una respuesta sin clasificar.
  - No concluido: no hubo respuesta, como un timeout, una conexión rechazada, un 408, 502, 503 o 504 después de sus reintentos, o la base que no se pudo consultar. También si la corrida se interrumpió.
  - No ejecutado: el caso no empezó, por ejemplo porque no le toca a esa integración.
- Aparte del resultado, el reporte dice si la evidencia quedó completa: cada paso que corrió tiene lo mínimo de su tipo, y cada comprobación guarda lo esperado y lo encontrado. Un caso Correcto con la evidencia incompleta enseña los dos hechos y no cuenta como aprobado.
- Cada caso se abre hasta su paso, su comprobación y su evidencia: lo esperado, lo encontrado y lo que se ejecutó.
- Cada corrida es independiente y guarda su reporte en su propia carpeta: repetir un caso da un reporte nuevo, sin mezclar ni pisar el anterior. Al terminar, el comando dice dónde quedó cada reporte.
- El reporte cuenta lo que pasó: no recomienda liberar ni inventa causas. El reporte de Playwright se conserva aparte.

**HU-06 Clonar, correr y entender el proyecto** · Must

Como revisor técnico, quiero clonar el repo y correrlo con pocos pasos, para entender cómo está armado sin pedir ayuda.

- Con Node 24 y Docker, `npm install` y `npm test` bastan para correr todo. Si no hay `.env`, se usan los valores de prueba de `.env.example`.
- Antes de los casos, una revisión rápida confirma que la base, PayRef y la wallet responden. Si Docker no está prendido, un puerto está ocupado o algo no responde, la corrida no empieza y dice qué falta.
- El README explica cómo correrlo, qué atrapa la versión con bugs y cómo está armado, y trae el paso a paso para agregar una integración y un caso. Ese paso a paso se comprueba siguiéndolo al pie de la letra para agregar una integración de prueba, sin ayuda.
- `npm run verify` revisa formato, lint, tipos y las pruebas del framework, sin Docker.

**HU-12 Probar el aviso aunque el tercero no lo mande** · Must

Como equipo de QA, quiero probar el aviso de pago de un tercero de las dos formas, armándolo y firmándolo como lo haría él, o dejando que lo mande su simulador, para no depender de que el tercero esté listo, sin hacer pasar un aviso simulado por una conexión probada.

- La wallet se prueba con las dos fuentes del aviso. La wallet simulada manda el webhook normal, repetido, tarde o con otro monto. El framework genera la firma como lo haría la wallet y hace esos cuatro, y además sin firma, con firma mala y de un recurso que no existe.
- Los positivos y los negativos corren con las dos fuentes. Si un caso pide algo que su fuente no puede hacer, no se corre, y el reporte dice por qué.
- Cuando el aviso lo manda la wallet, el paso observa: espera a que PayRef registre el webhook en la bitácora del puente, revisa ahí el resultado contra el esperado y después los movimientos. Su evidencia son las lecturas y la llamada que disparó a la wallet.
- El reporte dice en cada caso de dónde salió su aviso.

**HU-13 Probar el propio framework** · Must

Como equipo de QA, quiero que el framework tenga sus propias pruebas, para confiar en su veredicto: si el juez se equivoca, todo lo demás miente.

- El juez y las comprobaciones de la base se prueban con respuestas y filas controladas: aceptan el resultado exacto y detectan otro rechazo, una respuesta sin clasificar, un problema técnico, una diferencia con la base y una fuga que trae el código esperado. También separa Fallido de No concluido: un 500 contra un timeout o un 503.
- La evidencia se prueba: guarda lo que de verdad pasó, conserva el fallo, separa las corridas, oculta las credenciales y marca incompleto un paso al que le falta lo mínimo.
- Una integración de prueba, hecha solo con config sobre el contrato estándar, se carga y arma sus casos sin tocar código. Si prende la ventana de reverso, le tocan sus casos, y si no, no.
- Estas pruebas corren con `npm run test:unit`, sin PayRef ni Docker.

### E2. PayRef, el orquestador

**HU-07 Crear y administrar referencias** · Must

Como merchant, quiero crear referencias de pago, consultarlas y cancelarlas, para cobrarles a mis clientes donde ellos prefieran pagar.

- Entra con su propia llave y recibe un token, que usa en cada llamada.
- Puede crear los 8 tipos de referencia: única o recurrente, con monto fijo o libre, y con o sin vencimiento.
- El código que crea PayRef trae el largo de su región: 14 dígitos en México y 10 en Sudamérica.
- Crear una referencia con datos inválidos, como un monto en cero o con más decimales de los de su región, un monto fijo que no viene o un vencimiento que ya pasó, responde 400, dice qué campo falló y no crea nada.
- Puede consultar el estado de sus referencias: activa, pagada, cancelada o vencida. Vencida no se guarda: sale de la fecha y de la hora de su región.
- Puede cancelar una referencia activa. Una única pagada responde R-102, una ya cancelada R-105, y una con un pago en curso en la ventana del banco, R-108.
- Solo ve, cancela y pide el recurso de sus referencias. La de otro merchant responde R-101, como si no existiera, para no revelar que existe.
- Una referencia cancelada ya no se puede pagar.

**HU-08 Cobrar una referencia** · Must

Como payment method estándar, por ejemplo un súper, quiero consultar una referencia y avisar el pago cuando el cliente ya pagó, para que el pago quede registrado en el orquestador.

- Entra con su propia llave y recibe un token.
- Puede consultar la referencia antes de cobrar. Si no aplica, la consulta responde el mismo rechazo que daría la solicitud, y nunca registra nada.
- Manda la solicitud y el aviso, juntos o por separado según su configuración. La solicitud, o la llamada que junta las dos, trae su secuencia y recibe folio y autorización si la referencia aplica. Por separado, el aviso trae el folio de su solicitud.
- La solicitud valida por su cuenta, aunque nadie haya consultado antes.
- Si la referencia no aplica (no existe, está vencida, cancelada o ya pagada, o el monto no es válido), recibe el código de rechazo que corresponde.
- Un monto no es válido si es cero o negativo, si trae más decimales de los que permite su región, si es distinto al fijo o si sale de los topes del payment method, que valen incluidos. Se rechaza con R-104 y nunca se redondea.
- Si pide una operación que no tiene configurada, como reversar, recibe un 403.

**HU-09 Las mismas reglas para todos** · Must

Como merchant y como payment method, quiero que el orquestador aplique las mismas reglas a todos, para confiar en que un pago vale lo mismo, entre por donde entre.

- Cada quien entra con su llave. Una llave mala, una llamada sin token o un token inválido responden 401, y el token del otro rol, como un merchant que manda una solicitud, 403. Quién llama sale siempre del token, nunca del cuerpo.
- En el webhook lo que viaja es una firma, y si falta o no cuadra se rechaza con 401.
- Valida siempre en el mismo orden: la credencial, que la referencia exista, que no esté cancelada, que esté vigente, el monto, que no esté pagada, que no tenga un pago en curso y que la secuencia no esté repetida.
- Una referencia única ya pagada se rechaza con R-102, traiga la secuencia que traiga. Una secuencia que ese payment method ya usó en un pago se rechaza con R-106, igual que un segundo aviso del mismo folio. Un rechazo no deja nada, así que no gasta su secuencia.
- Responde siempre igual: 200 con el código de negocio cuando la petición llega al negocio, y 400, 401, 403 o 5xx cuando no llega.
- Respeta las reglas de cada región. Un código de otro largo no existe en esa región (R-101). El vencimiento es una fecha: la referencia se puede pagar todo ese día en la hora de su región (UTC−6 o UTC−3), y desde las 00:00 del día siguiente se rechaza con R-103. Los decimales del monto son los de su moneda: centavos en México y enteros en Sudamérica.
- Cada región guarda todo en su propia base, así que una referencia de otra región no existe (R-101).
- Ningún error enseña detalles internos, tampoco el 400 de una petición mal armada.

**HU-10 La ventana de reverso del banco** · Must

Como banco que prende la ventana de reverso en su configuración, quiero validar antes de confirmar y poder reversar dentro de la ventana, para deshacer un pago si algo falla de mi lado.

- Si la referencia aplica, la solicitud responde OK con folio y autorización, pero el pago queda pendiente.
- La ventana dura lo que diga la config del banco, 2 minutos por defecto, y al minuto 2 exacto ya cerró.
- Mientras corre la ventana, otra solicitud de la referencia se rechaza con R-108, sea única o recurrente, y el merchant tampoco la puede cancelar.
- La ventana protege al cliente, que pagó cuando la referencia estaba vigente y sin cancelar: si no hay reverso, el pago se confirma sin volver a validar, aunque la referencia venza mientras corre la ventana.
- Dentro de la ventana, el aviso confirma el pago, y el reverso lo deja reversado: la referencia vuelve a poder pagarse.
- Si el banco no hace nada, al vencer la ventana el pago se confirma solo. Se ve en la siguiente petición que toca la referencia o el pago, y el movimiento queda con la fecha en que venció la ventana.
- La ventana cierra con lo primero que pase: el aviso, el reverso o su vencimiento. Después, un reverso, o un aviso de un pago reversado, se rechaza con R-107, y un aviso de un pago ya confirmado se rechaza como repetido.
- La ventana es una regla de su configuración: otra integración la puede prender igual, sin código, y un banco que no la prende se porta como cualquier payment method estándar.

**HU-11 Pagar con QR o link y avisar por webhook** · Must

Como wallet, un payment method digital, quiero generar un QR o link de pago y avisar con un webhook firmado cuando el cliente paga, para que el cliente pague desde su app y el pago quede registrado en el orquestador.

- El merchant pide el QR o link con su token. Antes de pedírselo a la wallet, PayRef valida igual que en una solicitud estándar: primero lo que permite el merchant, que es la referencia, y después los topes del payment method. Si no aplica, responde el rechazo de negocio.
- El recurso es de un solo pago: mientras no se paga, pedirlo otra vez regresa el mismo. Ya pagado, una recurrente recibe uno nuevo, y una única responde R-102.
- El webhook viaja firmado. Si la firma falta o no cuadra, se rechaza con 401 y no se registra nada.
- Al llegar el webhook, PayRef vuelve a validar todo, por si algo cambió: si la referencia se venció o se canceló en medio, se rechaza y no se registra el pago.
- El webhook se liga al recurso por el id que le dio la wallet, nunca por la referencia.
- Un webhook con otro monto se rechaza con R-104, uno de un recurso que no existe con R-101, y uno repetido como un aviso repetido. En ninguno se registra nada, y nunca se responde un 500.
- Un rechazo de PayRef nunca se vuelve un éxito al pasar por el puente: si el core rechaza el webhook, el puente responde ese rechazo.

Lo extra es de cada integración, no de todos los bancos ni de todas las wallets: otra integración puede prender lo mismo con su configuración.

## 6. Requisitos no funcionales

| ID     | Requisito                                                                                                                                                                                                                       | Cómo se valida                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| RNF-01 | Corre en una máquina limpia: con Node 24 y Docker, `npm install` y `npm test` corren todo, sin pasos manuales, ni siquiera copiar el `.env`                                                                                     | Clonar en limpio y correr                                                                                     |
| RNF-02 | Las pruebas del framework corren sin PayRef ni Docker, en menos de 30 segundos                                                                                                                                                  | `npm run test:unit`                                                                                           |
| RNF-03 | El juez y la evidencia tienen al menos 80 % de cobertura de líneas y de ramas en las pruebas del framework                                                                                                                      | Reporte de cobertura de Vitest                                                                                |
| RNF-04 | El código pasa TypeScript estricto, ESLint y Prettier sin errores                                                                                                                                                               | `npm run verify`                                                                                              |
| RNF-05 | Ninguna evidencia guarda credenciales completas: el header `Authorization`, la llave y el token del auth salen ocultos. La firma del webhook queda visible, porque solo sirve para su propia petición, y el secreto nunca viaja | Prueba del framework sobre el enmascarado                                                                     |
| RNF-06 | Las credenciales del repo son de prueba: viven en `.env.example`, y el `.env` nunca se sube                                                                                                                                     | Revisión del repo y de `.gitignore`                                                                           |
| RNF-07 | Los casos son independientes: cada uno crea sus datos, y un caso suelto sale igual que dentro de la corrida completa                                                                                                            | Correr un caso solo y en la corrida completa                                                                  |
| RNF-08 | Ninguna prueba espera tiempo real: los casos de tiempo usan la hora de prueba                                                                                                                                                   | Regla de ESLint contra las esperas fijas                                                                      |
| RNF-09 | La corrida completa de una integración tarda menos de 5 minutos, con la imagen de MySQL ya descargada                                                                                                                           | Duración en el reporte. La primera corrida puede tardar más, y el README lo avisa                             |
| RNF-10 | Las corridas no se pisan: cada una guarda sus archivos aparte                                                                                                                                                                   | Correr dos veces y comparar las carpetas                                                                      |
| RNF-11 | El framework solo lee la base de PayRef, con un usuario de solo lectura                                                                                                                                                         | Antes de cada corrida, la revisión rápida intenta escribir con ese usuario, y si puede, la corrida no empieza |
| RNF-12 | Las pruebas dan siempre el mismo resultado: las nuevas corren 3 veces seguidas y salen igual las tres                                                                                                                           | `--repeat-each=3` al cerrar cada fase                                                                         |

## 7. Definición de terminado

Una historia está terminada cuando:

- Cumple sus criterios de aceptación.
- Sus pruebas pasan contra la versión 1.1 de PayRef, y las que atrapan bugs fallan contra la 1.0 donde les toca.
- Las pruebas del framework que la cubren pasan.
- Sus pruebas nuevas dan siempre el mismo resultado (RNF-12).
- `npm run verify` sale limpio.
- Su evidencia sale completa en el reporte, o en los archivos de la corrida mientras el reporte no exista.
- Los docs que toca están al día: el requerimiento, el análisis y las decisiones.
