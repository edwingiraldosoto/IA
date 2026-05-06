---
name: Estructura de Archivo ARGOS
description: Columnas específicas esperadas en archivos Excel ARGOS para carga de clientes
type: reference
---

## Estructura del Archivo Excel ARGOS

### Columnas Obligatorias
1. **Canal** - Tipo de canal (ej: MASIVO)
2. **Código de cliente** - Identificador único del cliente
3. **Nombre de la cuenta** - Nombre de la empresa/cuenta
4. **Nombre completo** - Nombre de la persona de contacto
5. **Dirección** - Dirección comercial
6. **Población** - Municipio/ciudad
7. **Departamento (Texto)** - Nombre del departamento
8. **Móvil** - Número telefónico
9. **Habeas data** - Autorización (valores: 0, 1, SI, NO)

### Columnas Opcionales
- Nombre de la obra/Nombre 2
- Cargo - Cargo de la persona
- Rol - Rol dentro de la organización
- Género - Género de la persona
- Departamento (Código) - Código del departamento
- Medio de autorización de habeas data
- Fecha de autorización habeas data
- Es punto de Venta al Público
- HABEAS DATA FIRMADO SI / NO

### Ejemplo de Fila
```
MASIVO | 1000220 | DEPOSITOS MEDELLIN EL BAGRE SAS | VICTOR EVERTO HOYOS MONTES | CR 50 48 A 28 | EL BAGRE | ANTIOQUIA | 3137391001 | 1
```

## Notas Importantes
- El archivo NO tiene columnas como "identificacion", "razon_social", etc. (estructura RUES)
- Es un formato más enfocado en información de contacto y autorización
- El Habeas data es un campo crítico (autorización para uso de datos)
- Móvil es campo clave para comunicación
