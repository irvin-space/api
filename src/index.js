require('dotenv').config();

const express = require("express");
const sql = require("mssql");
const jwt = require('jsonwebtoken');
const cors = require("cors");
const fs = require("fs"); 
const bodyParser = require('body-parser'); // <--- Asegúrate de tener bodyParser
const fetch = require('node-fetch'); // <--- CRÍTICO: Asegúrate de tener instalado node-fetch
const { Console } = require('console');

// --- Configuración General ---
const PORT = process.env.PORT || 3001;
const JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';
const JWT_EXPIRES_IN = '24h';
// Asegúrate de que este archivo existe y la exportación es correcta:
const sqlConfig = require("./config"); 
const { type } = require('os');
const app = express();

// Configuración de Middlewares
app.use(cors({ origin: 'http://localhost:3000' })); // Reemplaza con el puerto de tu aplicación React
//app.use(bodyParser.json());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

///
// // Configuración de Middlewares (Ajustar límite de tamaño del cuerpo de la solicitud)
// // Se aumenta el límite a 50MB para soportar imágenes grandes en Base64 para Gemini Vision.
// app.use(express.json({ limit: '50mb' })); 
// app.use(express.urlencoded({ limit: '50mb', extended: true }));

// //**Si usas `body-parser` (que parece ser tu caso):**

// //Si en tu código original tienes:
// //```javascript
// app.use(bodyParser.json());
// // ...deberás cambiarlo por:
// // ```javascript
// app.use(bodyParser.json({ limit: '50mb' }));

// He actualizado el archivo asumiendo el uso moderno de `express.json()`, pero he dejado la sección de `body-parser` comentada en el código anterior como referencia si la necesitas. Con un límite de **`50mb`**, deberías poder enviar imágenes de muy alta resolución a tu *endpoint* sin problemas de tamaño de payload.
// /////


// --- Configuración de IA (Google Gemini) ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error("❌ ERROR CRÍTICO: La variable GEMINI_API_KEY no está definida en .env.");
}

// 🔑 CONFIGURACIÓN BASE DEL MODELO GEMINI 
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;
const MAX_RETRIES = 3;

// La instrucción principal para el modelo (define su personalidad y contexto ERP)
const SYSTEM_INSTRUCTION_TEXT = `
  Eres un asistente de soporte de un ERP de gestión financiera y aduanal. 
  Tu rol es ayudar a los usuarios con consultas sobre facturas, estados de cuenta, 
  saldos, y terminología técnica (e.g., UUID, Poliza, Pedimento).
  Responde de manera concisa, formal y útil. NO reveles que eres una IA, actúa como un experto de soporte.
  Si te preguntan algo fuera de finanzas o ERP, pide amablemente que se enfoquen en temas del negocio.
`;

// --- DEFINICIÓN DE HERRAMIENTAS (TOOL DECLARATIONS) ---

// 1. Declaración de la función para obtener saldo de factura
const functionDeclaration = {
    name: "get_invoice_balance",
    description: "Obtiene el saldo actual y el estatus de una factura específica utilizando el folio fiscal.",
    parameters: {
        type: "OBJECT",
        properties: {
            tipo_consulta:{
                type: "STRING",
                description: "El tipo de consulta a realizar. Puede ser 'Pedimento' para desplegar informacion del mismo, 'Factura', 'Finanzas', 'Pólizas', etc"
            },
            fiscal_folio: {
                type: "STRING",
                description: "El folio fiscal o la referencia fiscal de la factura, por ejemplo, 'A 1984', 'AB-123', '15256'."
            }
        },
        required: ["tipo_consulta","fiscal_folio"]
    }
};

// 2. Estructura de herramientas (CRÍTICA: esta debe ser correcta)
const toolDefinitions = [
    {
        function_declarations: [functionDeclaration]
    }
];

// --- LÓGICA DE HERRAMIENTAS REALES (SQL SERVER) ---

/**
 * [REAL SQL CALL] Llama al procedimiento almacenado Consulta_SQL_ChatBot en SQL Server.
 * @param {object} args - Argumentos extraídos por Gemini (invoice_folio, fiscal_folio, customer_rfc).
 * @returns {object} El resultado de la consulta para ser enviado de vuelta a Gemini.
 */
async function callTraeSaldoFactura(args) {
    try {
        const rawParams = {
            tipo_consulta: args.tipo_consulta,
            fiscal_folio: args.fiscal_folio
        };
        
        // 1. Formatear los parámetros para la sintaxis de SQL Server
        const formattedParams = formatSqlParams(rawParams);
        
        // 2. Conexión y ejecución de la consulta
        await sql.connect(sqlConfig);
        
        const sqlQuery = `EXEC Consulta_SQL_ChatBot ${formattedParams}`;
        console.log(`[SQL QUERY TOOL] Ejecutando: ${sqlQuery}`);
        
        const result = await sql.query(sqlQuery);

        if (result.recordset && result.recordset.length > 0) {
            // El SP devolvió resultados
            return { 
                query_status: "success", 
                invoice_data: result.recordset[0]
            };
        } else {
            // Caso donde el SP no devuelve registros
            return { 
                query_status: "not_found", 
                error_message: "La factura fue consultada, pero no se encontró un registro de saldo. Verifique los folios y RFC." 
            };
        }
    } catch (sqlError) {
        // Manejo de errores de conexión o ejecución
        console.error(`[SQL ERROR FATAL] Error al ejecutar Consulta_SQL_ChatBot: ${sqlError.message}`);
        return { 
            query_status: "fatal_error", 
            error_message: `Ocurrió un error en la base de datos al buscar la factura: ${sqlError.message}` 
        };
    }
}


/**
 * Función que maneja el ciclo de la conversación, incluyendo llamadas a funciones (tool calling recursivo).
 * @param {object[]} contents - El historial de chat y el nuevo mensaje.
 * @returns {string} La respuesta de texto final generada por el modelo.
 */
async function generateContentWithRetry(contents) {
    // Si tienes problemas de compatibilidad con Node.js, asegúrate de que fetch esté instalado: npm install node-fetch@2
    if (typeof fetch === 'undefined') {
        throw new Error("ERROR FATAL: La función 'fetch' no está disponible. Asegúrate de instalar 'node-fetch@2' si usas Node < 18.");
    }

    const payloadBase = {
        systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION_TEXT }]
        },
        tools: toolDefinitions, // <--- CRÍTICO: Envía la estructura correcta
    };

    let currentContents = [...contents];
    let maxCalls = 5; // Límite de recursividad para prevenir bucles infinitos

    while (maxCalls > 0) {
        maxCalls--;

        const payload = { ...payloadBase, contents: currentContents };
        console.log(`[API CALL] Llamada a Gemini (recursividad restante: ${maxCalls})`);

        let responseJson;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(GEMINI_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (response.status === 429 && attempt < MAX_RETRIES) {
                    const delay = Math.pow(2, attempt) * 1000;
                    console.warn(`[API] Throttle (429). Retrying in ${delay / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                if (!response.ok) {
                    const errorBody = await response.text();
                    console.error(`[API ERROR] Status: ${response.status}, Body: ${errorBody}`);
                    throw new Error(`API Error ${response.status}: ${errorBody}`);
                }

                responseJson = await response.json();
                break; 
            } catch (error) {
                console.error(`Attempt ${attempt} failed:`, error.message);
                if (attempt === MAX_RETRIES) {
                    throw new Error("El servicio de IA falló después de múltiples reintentos.");
                }
            }
        }

        const candidate = responseJson?.candidates?.[0];
        
        if (!candidate) {
            console.error("[GEMINI FAIL] No se encontró candidato en la respuesta. Respuesta completa:", JSON.stringify(responseJson, null, 2));
            return "No se pudo obtener una respuesta válida del modelo (candidato vacío).";
        }
        
        // 2. Revisar si hay una Solicitud de Función (TOOL CALL)
        // Buscamos la función en las dos ubicaciones posibles para el modelo (array o anidado)
        let functionCall = candidate.functionCalls?.[0];
        if (!functionCall && candidate.content?.parts?.[0]?.functionCall) {
            functionCall = candidate.content.parts[0].functionCall;
        }

        if (functionCall) {
            const { name, args } = functionCall;
            console.log(`[FUNCTION CALL DETECTED] Name: ${name}, Args: ${JSON.stringify(args)}`);

            let functionResult;
            if (name === "get_invoice_balance") {
                functionResult = await callTraeSaldoFactura(args);
            } else {
                functionResult = { 
                    query_status: "error", 
                    error_message: `El modelo solicitó una función desconocida: ${name}`
                };
            }
            
            // 3. Agregar la Solicitud y la Respuesta de la Función al historial
            currentContents.push(
                // Modelo: llama a la función
                { role: "model", parts: [{ functionCall: { name, args } }] }, 
                // Función: responde con el resultado
                { role: "function", parts: [{ functionResponse: { name, response: functionResult } }] }
            );
            
            continue; // Volver a llamar a la API de Gemini con el historial actualizado
        }

        // 4. Respuesta Final de Texto
        const text = candidate.content?.parts?.[0]?.text;
        if (text) {
            return text; 
        }
        
        // Si no hay texto ni functionCall, loguea el error y termina.
        console.error("[GEMINI FAIL] El candidato no contiene texto ni llamada a función. Respuesta:", JSON.stringify(responseJson, null, 2));
        return "El modelo no proporcionó texto ni solicitó una función válida después del último intento.";
    }
    
    return "Error: Se superó el límite de llamadas recursivas de funciones.";
}


// --- ENDPOINT PRINCIPAL DEL CHATBOT ---

app.post('/api/chat', async (req, res) => {
    const { message, history = [] } = req.body;
    console.log(`[CHAT] Nuevo mensaje de usuario: ${message}`);

    if (!message) {
        return res.status(400).json({ error: 'Falta el parámetro "message".' });
    }

    // Mapear el historial del cliente al formato 'contents' de Gemini
    const geminiHistory = history.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
    }));

    // Agregar el mensaje actual del usuario
    const contents = [...geminiHistory, { role: 'user', parts: [{ text: message }] }];

    try {
        const aiResponse = await generateContentWithRetry(contents);
        res.json({ response: aiResponse });
    } catch (error) {
        console.error('Error in /api/chat:', error);
        // Devolver un error amigable al cliente
        res.status(500).json({ error: error.message || "Error interno al procesar la solicitud de IA." });
    }
});


// --- SCHEMAS DE EXTRACCIÓN (Resto del código del usuario) ---
// ... (Tus esquemas JSON de extracción de documentos)
const documentExtractionSchema = {
    type: "object",
    properties: {
        // --- INFORMACIÓN CLAVE DEL DOCUMENTO ---
        invoice_number: { type: "string", description: "Número de Factura (Invoice Number)."},
        invoice_date: { type: "string", description: "Fecha de la Factura (Invoice Date) en formato YYYY-MM-DD. Si no es un formato de fecha válido, devuelve 'N/A'."},
        po_number: { type: "string", description: "Número de Orden de Compra (PO Number). Si no existe, devuelve una cadena vacía."},
        // --- DATOS DE MONTO Y PESO ---
        currency: { type: "string", description: "Moneda utilizada (ej. USD, MXN, EUR)."},
        subtotal_amount: { type: "number", description: "El monto subtotal de la Factura (antes de impuestos/cargos). Si no existe, devuelve 0."},
        tax_amount: { type: "number", description: "El monto total de impuestos (Tax Amount). Si no existe, devuelve 0."},
        total_amount: { type: "number", description: "El monto total final de la Factura (Invoice Amount) en números."},
        total_gross_weight_kg: { type: "number", description: "El peso bruto total (Gross Weight) en kilogramos (KG). Si solo hay peso en LB, convertirlo a KG (1 lb = 0.453592 kg) y devolverlo aquí."},
        // --- INFORMACIÓN DE ENTIDADES ---
        vendor_name: { type: "string", description: "Nombre completo de la entidad que emite la factura (Proveedor/Vendedor)."},
        vendor_tax_id: { type: "string", description: "Número de identificación fiscal o RFC del proveedor."},
        sold_to_id: { type: "string", description: "El ID de la entidad 'SOLD TO' (ej. P3621 ID:)."},
        // --- DETALLE DE PRODUCTOS (ARRAY) ---
        products: { 
            type: "array",
            description: "Lista de todos los productos o servicios detallados en las líneas de la factura. Si no hay líneas de producto, devuelve un array vacío (ej. []).",
            items: {
                type: "object",
                properties: {
                    item_sku: { type: "string", description: "SKU o número de parte del producto."},
                    item_description: { type: "string", description: "Descripción completa del producto o servicio."},
                    item_quantity: { type: "number", description: "Cantidad de unidades."},
                    item_unit_price: { type: "number", description: "Precio unitario (sin impuestos)."},
                    item_line_total: { type: "number", description: "Total de la línea (Cantidad * Precio Unitario)."}
                },
                required: ["item_description", "item_quantity", "item_line_total"]
            }
        },
        // --- OBSERVACIONES ---
        observaciones_ia: { type: "string", description: "Observación sobre la legibilidad del documento (ej. 'Documento escaneado y claro', 'Algunos campos están borrosos')."}
    },
    // Definimos solo los campos más importantes como estrictamente necesarios para forzar una respuesta
    required: ["invoice_number", "invoice_date", "currency", "total_amount", "vendor_name", "products"]
};

const documentExtractionSchema_SP = {
    // La raíz del esquema debe ser un objeto
    type: "object", 
    // Las propiedades del objeto
    properties: {
        // --- INFORMACIÓN CLAVE DEL DOCUMENTO ---
        numero_factura: { type: "string", description: "Número de Factura."},
        uuid: { type: "string", description: "Identificador Fiscal Unico."},
        fecha_factura: { type: "string", description: "Fecha de la Factura en formato YYYY-MM-DD. Si no es un formato de fecha válido, devuelve 'N/A'."},
        numero_orden_compra: { type: "string", description: "Número de Orden de Compra (PO Number). Si no existe, devuelve una cadena vacía."},
        metodo_pago: { type: "string", description: "Método de Pago utilizado en la Factura."},
        forma_pago: { type: "string", description: "Forma de Pago utilizada en la Factura."},
        tasa_iva: { type: "number", description: "Tasa de IVA aplicada en la Factura."},
        
        // --- DATOS DE MONTO Y PESO ---
        moneda: { type: "string", description: "Moneda utilizada (ej. USD, MXN, EUR)."},
        subtotal: { type: "number", description: "El monto subtotal de la Factura (antes de impuestos/cargos). Si no existe, devuelve 0."},
        impuesto: { type: "number", description: "El monto total de impuestos (Tax Amount). Si no existe, devuelve 0."},
        total: { type: "number", description: "El monto total final de la Factura (Invoice Amount) en números."},
        
        // --- INFORMACIÓN DE ENTIDADES (Corrección en RFC Receptor) ---
        nombre_emisor: { type: "string", description: "Nombre completo de la entidad que emite la factura (Proveedor/Vendedor)."},
        rfc_emisor: { type: "string", description: "RFC del proveedor."},
        domicilio_emisor: { type: "string", description: "Domicilio completo del emisor."},
        regimen_fiscal_emisor: { type: "string", description: "Clave y Regimen fiscal del emisor."},
        nombre_receptor: { type: "string", description: "Nombre completo de la entidad que recibe solicita la factura (cliente)."},
        // ✅ CORREGIDO: rfc_receptos -> rfc_receptor
        rfc_receptor: { type: "string", description: "RFC del cliente/receptor."}, 
        domicilio_receptor: { type: "string", description: "Domicilio completo del receptor."},
        regimen_fiscal_receptor: { type: "string", description: "Clave y Regimen fiscal del receptor."},
            
        // --- DETALLE DE PRODUCTOS (ARRAY) ---
        productos: { 
            type: "array",
            // ✅ CORRECCIÓN: Se usa 'description' en lugar de 'descripcion'
            description: "Lista de todos los productos o servicios detallados en las líneas de la factura. Si no hay líneas de producto, devuelve un array vacío (ej. []).",
            items: {
                type: "object",
                properties: {
                    sku: { type: "string", description: "SKU o número de parte del producto."},
                    clave_producto: { type: "string", description: "Clave del producto o servicio."},
                    clave_unidad: { type: "string", description: "Clave de la unidad de medida."},
                    unidad_medida: { type: "string", description: "Unidad de medida del producto."},
                    descripcion: { type: "string", description: "Descripción completa del producto o servicio."},
                    cantidad: { type: "number", description: "Cantidad de unidades."},
                    precio_unitario: { type: "number", description: "Precio unitario (sin impuestos)."},
                    importe: { type: "number", description: "Total de la línea (Cantidad * Precio Unitario)."}
                },
                required: ["descripcion", "cantidad", "importe"]
            }
        },
        
        // --- OBSERVACIONES ---
        observaciones_ia: { type: "string", description: "Observación sobre la legibilidad del documento (ej. 'Documento escaneado y claro', 'Algunos campos están borrosos')."}
    },
    // Definimos solo los campos más importantes como estrictamente necesarios para forzar una respuesta
    required: ["numero_factura", "uuid", "moneda", "total", "rfc_emisor", "productos"]
};

function getMimeTypeFromExtension(tipoArchivo, isText = false) {
    if (isText) {
        if (tipoArchivo && tipoArchivo.toLowerCase().includes('xml')) return 'application/xml';
        if (tipoArchivo && tipoArchivo.toLowerCase().includes('json')) return 'application/json';
        return 'text/plain';
    }
    if (tipoArchivo && tipoArchivo.toLowerCase().includes('pdf')) return 'application/pdf';
    if (tipoArchivo && tipoArchivo.toLowerCase().includes('jpg')) return 'image/jpeg';
    if (tipoArchivo && tipoArchivo.toLowerCase().includes('png')) return 'image/png';
    return 'application/octet-stream';
}

// --- Función Auxiliar para Parámetros SQL (Limpieza de parámetros) ---
function formatSqlParams(parametros) {
    let stringParametros = "";
    if (!parametros || typeof parametros !== 'object') {
        return "";
    }
    
    // DEBUG LOG: Ver los parámetros de entrada brutos antes de procesar
    console.log("[DEBUG] Raw Input Parameters (FormatSQL):", JSON.stringify(parametros));

    for (let key in parametros) {
        if (!parametros.hasOwnProperty(key)) continue;

        const value = parametros[key];
        let quotedValue;
        
        let rawStringValue = value;
        if (typeof value === 'string' || value instanceof String) {
            // Trim normal de espacios normales al inicio/fin
            rawStringValue = value.trim(); 
            
            // Detectar y remover comillas externas innecesarias que pueda añadir la IA
            if (rawStringValue.startsWith("'") && rawStringValue.endsWith("'")) {
                rawStringValue = rawStringValue.substring(1, rawStringValue.length - 1).trim(); 
            }
        }

        // TRATAMIENTO DE NÚMEROS: Si es un número puro, no lo citamos.
        let cleanedNumericTest = (typeof rawStringValue === 'string') 
            ? rawStringValue.replace(/[\s\uFEFF\xA0]+/g, '') 
            : rawStringValue;

        // Solo si la cadena restante es puramente dígitos (sin punto decimal).
        const isPureInteger = typeof cleanedNumericTest === 'string' && /^\d+$/.test(cleanedNumericTest);

        if (isPureInteger) {
            quotedValue = cleanedNumericTest; // Número sin comillas
            
        } else if (typeof rawStringValue === 'string' || rawStringValue instanceof String) {
            // TRATAMIENTO DE CADENAS (incluyendo UUID, RFC y folios con letras/espacios)
            // Escapar comillas simples internas y envolver en comillas simples externas.
            quotedValue = `'${rawStringValue.replace(/'/g, "''")}'`; 
            
        } else {
            quotedValue = rawStringValue;
        }

        if (stringParametros.length > 0) stringParametros += ", ";
        
        // Asumimos que el SP es posicional (sin @nombreParam)
        stringParametros += `${quotedValue}`;
    }
    
    console.log("[DEBUG] Formatted SQL Parameters (FormatSQL):", stringParametros);

    return stringParametros;
}


// --- Endpoints de Conexión y Autenticación ---

app.get("/", async (req, res) => {
    try {
        await sql.connect(sqlConfig);
        // Prueba de conexión simple
        const result = await sql.query("SELECT GETDATE() as CurrentDateTime");
        res.send("✅ DB connection successful: " + JSON.stringify(result.recordset));
    } catch (err) {
        console.error(err);
        res.status(500).send("❌ DB connection failed: " + err.message);
    }
});

// Endpoint de login
app.post('/user/login', async (req, res) => {
    console.log("Login attempt received");
    try {
        const { email: usuarioInput } = req.body; 

        if (!usuarioInput) {
            return res.status(400).json({ success: false, message: 'Usuario is required' });
        }

        await sql.connect(sqlConfig);
        const result = await sql.query(`valida_usuario '${usuarioInput}'`); // Parámetro de string entre comillas

        if (!result.recordset || result.recordset.length === 0 || result.recordset[0].vigencia !== 'Válido') {
            return res.status(401).json({ success: false, message: 'User not found or not active' });
        }
        // ... (resto de la lógica de login)
        const user = result.recordset[0];
        let menu = [];
        if (result.recordsets[1] && result.recordsets[1][0]) {
            const jsonString = Object.values(result.recordsets[1][0])[0]; 
            const parsed = JSON.parse(jsonString);
            menu = parsed.Menu || [];
        }

        const serviceToken = jwt.sign(
            { id: user.usuario, email: user.usuario, name: user.nombre_persona, role: 'user', sucursal: user.sucursal, sucursalName: user.nombre_sucursal, id_persona: user.id_persona },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        return res.json({
            serviceToken,
            user: {
                id: user.usuario,
                name: user.nombre_persona,
                email: user.usuario,
                role: 'user',
                sucursal: user.sucursal,
                sucursalName: user.nombre_sucursal,
                id_persona: user.id_persona
            },
            menu 
        });

    } catch (err) {
        console.error('Error during login:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Endpoint de refresh token (/user/cuenta/yo)
app.post('/user/cuenta/yo', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        await sql.connect(sqlConfig);
        const result = await sql.query(`valida_usuario '${decoded.email}'`);

        if (result.recordset.length === 0) {
            return res.status(401).json({ message: 'User not found' });
        }

        const user = result.recordset[0];
        let menu = [];
        if (result.recordsets[1] && result.recordsets[1][0]) {
            const jsonString = Object.values(result.recordsets[1][0])[0];
            const parsed = JSON.parse(jsonString);
            menu = parsed.Menu || [];
        }

        return res.json({
            user: {
                id: user.usuario,
                name: user.nombre_persona,
                email: user.usuario,
                role: 'user',
                sucursal: user.sucursal,
                sucursalName: user.nombre_sucursal,
                id_persona: user.id_persona
            },
            menu 
        });
    } catch (err) {
        console.error('Error in /user/cuenta/yo:', err);
        return res.status(401).json({ message: 'Invalid token' });
    }
});

// --- Endpoints de SQL Dinámicos ---

//Componente lista dinamico
app.post("/dinamico/lista", async (req, res) => {
  try {
    const { instruccionSQL, parametros } = req.body;
    console.log(instruccionSQL);
    console.log("parametros recibidos",parametros);

    if(instruccionSQL == "Trae_Tramite_Aduanal"){
      let numberFolio = Number(parametros)
      console.log("NUMBER FOLIO", numberFolio, typeof numberFolio)

      //Intentar conectarse a la BD
    await sql.connect(sqlConfig);

      //Consulta con instruccionSQL y numbero de folio
    const result = await sql.query(`${instruccionSQL} ${numberFolio}`);

    console.log(result.recordsets)
    //Respuesta enviada
    res.status(200).json(result.recordsets);
    return 
    }

    let stringParametros = "";
    for (let key in parametros) {
      const value = parametros[key];
      if (stringParametros.length > 0) stringParametros += ", ";
      console.log(typeof value)
      console.log(value)
      console.log(key)
      console.log(typeof key)
      if(key.startsWith("@")){
        console.log("it starts with @")
        stringParametros += `${key}=${value}`; // "@cCentro='      1'"
      }else{
        stringParametros += `${value}`
      }

    }

    console.log("instruccionSQL", instruccionSQL);
    console.log("stringParametros", stringParametros);
    console.log(`${instruccionSQL}  ${stringParametros}`);

    //Intentar conectarse a la BD
    await sql.connect(sqlConfig);

 const result = await sql.query(`${instruccionSQL} ${stringParametros}`);

  console.log(result);

    res.status(200).json(result.recordsets);
  } catch (error) {
    console.error("Error al intentar obtener lista dinamica", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Endpoint de consulta general (consulta)
app.post("/consulta", async (req, res) => {
  // const { Consulta, Otros, Solo_Activas } = req.body;
  console.log(req.body);
  console.log(req.body.Procedimiento);
  let procedimiento = req.body.Procedimiento;
  let parametros = req.body.Parametros;

  let parametrosConcatenados = "";

  for (let valor of Object.values(parametros)) {
    console.log("a");
    // console.log(a)
    parametrosConcatenados = parametrosConcatenados + valor + ",";
  }

  console.log(parametrosConcatenados);
  let parametrosListos = parametrosConcatenados.slice(0, -1);
  console.log(parametrosListos);

  let consulta = `${procedimiento} ${parametrosListos}`;
  console.log(consulta);

  // if (!Consulta || !Otros || !Solo_Activas) {
  //   return res.status(400).json({ error: 'Faltan parámetros requeridos' });
  // }
  try {
    await sql.connect(sqlConfig);
    // Ejemplo: si parametro2 es el nombre del procedimiento y parametro1 es el valor
    const result = await sql.query(`${procedimiento} ${parametrosListos}`);
    console.log(result);
    res.json({ resultado: JSON.stringify(result) });
  } catch (err) {
    console.error(err);
    fs.appendFile(
      "error.log",
      `[${new Date().toISOString()}] ${err.stack}\n`,
      (fsErr) => {
        if (fsErr) console.error("Failed to write to log:", fsErr);
      }
    );
    res.status(500).json({ error: "Error en el procedimiento" + err.message });
  }
});

app.post("/busqueda/tramites", async (req, res) => {
  try {
    const { instruccionSQL, parametros } = req.body;
    console.log(instruccionSQL);
    console.log(parametros); //


    let stringParametros = "";
    for (let key in parametros) {
      const value = parametros[key];
      if (stringParametros.length > 0) stringParametros += ", ";
      stringParametros += `${key}=${value}`;
    }

    console.log("instruccionSQL", instruccionSQL);
    console.log("stringParametros", stringParametros);
    console.log(`${instruccionSQL}  ${stringParametros}`);

    //Intentar conectarse a la BD
    await sql.connect(sqlConfig);

    const result = await sql.query(`${instruccionSQL}  ${stringParametros}`);

    console.log(result);

    res.status(200).json(result.recordsets);
  } catch (error) {
    console.error("Error al intentar obtener lista dinamica", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Endpoint ejecuta (similar a dinamico/lista)
app.post("/ejecuta", async (req, res) => {
  try {
    const { instruccionSQL, parametros } = req.body;
    console.log(instruccionSQL);
    console.log("a",parametros);

    let stringParametros = "";
    for (let key in parametros) {
      const value = parametros[key];
      if (stringParametros.length > 0) stringParametros += ", ";
      console.log(typeof value)
      console.log(value)
      console.log(key)
      console.log(typeof key)
      if(key.startsWith("@")){
        console.log("it starts with @")
        stringParametros += `${key}=${value}`; 
      }else{
        stringParametros += `${value}`
      }
    }

    console.log("instruccionSQL", instruccionSQL);
    console.log("stringParametros", stringParametros);
    console.log(`${instruccionSQL}  ${stringParametros}`);

    //Intentar conectarse a la BD
    await sql.connect(sqlConfig);

    const result = await sql.query(`${instruccionSQL} ${stringParametros}`);
    console.log(result);
    res.status(200).json(result.recordsets);
  } catch (error) {
    console.error("Error al intentar obtener lista dinamica", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Endpoint para análisis multimodal con IA GEMINI (Se corrige extracción de texto)
// Se mantuvo el código original del usuario para este endpoint, asumiendo que funciona con el SDK de Gemini.
app.post('/analizar-documento-gemini', async (req, res) => {
    console.log("[ENDPOINT] /analizar-documento-gemini iniciado."); 

    // Asegúrate de que 'ai' o el SDK de Google Generative AI esté inicializado
    // Si estás usando el SDK, este endpoint debe ser adaptado para usar 'fetch' o el SDK correctamente.
    // Usaremos un mock de modelo simple, si el user no está usando el SDK y solo fetch:
    const mockModelCall = async (contents, config) => {
        const apiKey = GEMINI_API_KEY;
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

        const payload = {
            contents: contents,
            generationConfig: config,
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Multimodal API Error ${response.status}: ${errorBody}`);
        }
        return await response.json();
    }
    
    try {
        // 1. EXTRAER LOS NUEVOS ARGUMENTOS
        const { tramite_id, file, tipoDocumento, prompt } = req.body;
        console.log("Datos recibidos:", { tramite_id, tipoDocumento, prompt, file: file ? "Sí" : "No" });

        const { base64, mimeType } = file; 

        // 2. VALIDACIÓN AMPLIADA DE ENTRADAS
        if (!base64 || !mimeType || !tipoDocumento || !prompt) {
            return res.status(400).json({ success: false, message: "Faltan datos (file,  tipoDocumento, o prompt) en la solicitud." });
        }
        
        console.log(`[Gemini] Análisis para Trámite ID: ${tramite_id}, Tipo: ${mimeType}`);

        const isDocumentExtraction = tipoDocumento !== 'Otro'; // Si no es 'otro', asumimos que es documento estructurado

        let dinamicShema;

        if (tipoDocumento === 'Invoice') {
            dinamicShema = documentExtractionSchema;
        } else {
            dinamicShema = documentExtractionSchema_SP;
        }

        let dynamicPrompt;
        let generationConfig = {};

        if (isDocumentExtraction) {
            // --- CÓDIGO PARA EXTRACCIÓN ESTRUCTURADA (PDF, XML, etc.) ---
            if (!tipoDocumento) {
                return res.status(400).json({ 
                    success: false, 
                    message: "El tipoDocumento es requerido para la extracción de documentos estructurados." 
                });
            }

            dynamicPrompt = `
                ${prompt} 
                
                ---
                
                El documento adjunto es de tipo: "${tipoDocumento}". 
                Tu tarea es analizar el documento adjunto y extraer la información solicitada en el esquema JSON, 
                asegurándote de que los tipos de datos (string, number, array) sean correctos. 
                Si un campo obligatorio no se encuentra, debes deducirlo del contexto o devolver un valor por defecto ('N/A' o 0) según la descripción.
            `;

            generationConfig = {
                responseMimeType: "application/json",
                responseSchema: dinamicShema,
            };
        } else {
            // --- CÓDIGO PARA ANÁLISIS DE IMAGEN/OTROS DOCUMENTOS (TEXTUAL) ---
            dynamicPrompt = prompt; // Usar el prompt del usuario directamente
            // No se necesita generationConfig si la respuesta es texto libre
        }

        const imagePart = {
            inlineData: {
                data: base64,
                mimeType,
            }
        };

        const responseJson = await mockModelCall(
            [{ role: "user", parts: [{ text: dynamicPrompt }, imagePart] }], 
            generationConfig
        );
        
        const responseText = responseJson.candidates[0].content.parts[0].text;
        
        if (isDocumentExtraction) {
            // Si es una extracción, la respuesta es un JSON que hay que parsear
            const parsedJson = JSON.parse(responseText);
            res.json({ success: true, data: parsedJson });
        } else {
            // Si es solo texto, devolver el texto directamente
            res.json({ success: true, data: { analysis: responseText } });
        }
        
    } catch (error) {
        console.error("Error en el análisis multimodal con Gemini:", error.message);
        // Si la IA falla al generar JSON, el error de parseo será atrapado aquí.
        res.status(500).json({ 
            success: false, 
            message: "Error interno en el servicio de IA. Verifique el formato de respuesta esperado." 
        });
    }
});


// Inicio del servidor
app.listen(PORT, () => {
    console.log(`Node.js Server corriendo en http://localhost:${PORT}`);
});
