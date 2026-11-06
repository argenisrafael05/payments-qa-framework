# Cómo agregar una integración o un caso

## Una integración

Es config de los dos lados, el de PayRef y el del framework. Esto es para una integración con el contrato estándar. Una con contrato propio, como la wallet, además trae su cliente y su traducción.

1. Agrega su payment method a la config de su región en PayRef, `payref/config/mx.json` o `payref/config/sa.json`: su id, su nombre, `"kind": "standard"`, la variable que guarda su llave, las operaciones que puede usar y sus topes de monto. Si se parece al banco, también puede prender `"reversalWindow": { "minutes": 2 }`.
2. Agrega su llave a `.env.example`.
3. Crea `framework/integrations/<id>/integration.json`. Copia el de la integración que más se le parezca y cambia lo que sea distinto. Si PayRef le prende la ventana, agrega la misma aquí.
4. Corre `npm test -- <id>`.

El catálogo completo corre en ella de una vez, y lo que no le aplica sale como No ejecutado, con su razón.

## Un caso

Agrégalo a su familia en `framework/cases/base/`. Por ejemplo, una referencia única de monto fijo, pagada con el monto normal de su región:

```json
{
  "id": "F01-02",
  "title": "A fixed single reference is paid",
  "flow": "payment",
  "reference": { "type": "single", "amountType": "fixed" },
  "objective": { "step": "notice", "expect": "OK" },
  "tags": ["hu-01"]
}
```

Después agrega su fila a [la matriz de casos](test-matrix.md). Las pruebas del framework revisan que cada caso tenga su fila, con las mismas historias que sus tags.
