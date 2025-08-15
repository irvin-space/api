//Leer variables en archivo .env
const express = require("express");
const sql = require("mssql");
// const jwt = require("jsonwebtoken")
const cors = require("cors");

const app = express();

//File System module
const fs = require("fs");

//SQL Server Config
const sqlConfig = require("./config");

// Middleware para parsear JSON
app.use(express.json());

//Middleware para cors
app.use(cors());


//Endpoints inician

app.get("/", async (req, res) => {
  try {
    let parametros = {
      parametro1: "      1",
      parametro2: "COMBO_SUCURSALES",
    };
    await sql.connect(sqlConfig);
    const result = await sql.query(
      `${parametros.parametro2} "${parametros.parametro1}"`
    );
    console.log(result);
    res.send("✅ DB connection successful: " + JSON.stringify(result));
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ DB connection failed: " + err.message);
  }
});

app.post("/user/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log(email, password);

    // if(email == 'usuarioPrueba' && password == '1234'){
    //   res.send("Usuario y contraseña correctos")
    // }else{
    //   res.status(401).send("Datos incorrectos")
    // }

    await sql.connect(sqlConfig);
    // Ejemplo: si parametro2 es el nombre del procedimiento y parametro1 es el valor
    const result = await sql.query(`valida_usuario ${email}`);
    res.json({ resultado: JSON.stringify(result) });
    // res.send(result)
    // console.log(result);
  } catch (err) {
    console.log("Error al intentar loggearse: ", err);
  }
});

//Componente lista dinamico
app.post("/dinamico/lista", async (req, res) => {
  try {
    const { instruccionSQL, parametros } = req.body;
    console.log(instruccionSQL);
    console.log(parametros);

    // Validar instruccionSQL
    const allowedInstructions = [
      "combo_tasas_ivas",
      "combo_sucursales",
      "combo_formas_pago",
    ];
    if (!allowedInstructions.includes(instruccionSQL)) {
      return res.status(400).json({ error: "Invalid SQL instruction" });
    }

    // //Iterar sobre los parametros entrantes y crear un nuevo string
    // let instruccionSQLConParametros = ""

    // instruccionSQLConParametros = instruccionSQL

    // Build parameter string
    let stringParametros = "";
    for (let key in parametros) {
      const value = parametros[key];
      if (stringParametros.length > 0) stringParametros += ", ";
      stringParametros += `${key}=${value}`;
    }

    console.log("instruccionSQL", instruccionSQL);
    console.log("stringParametros", stringParametros);
    console.log(`${instruccionSQL}  ${stringParametros}`);

    //Intentar conectarse a la BD
    await sql.connect(sqlConfig);

    // const result = await sql.query(`${instruccionSQL} "${parametro1}" `);
    // const result = await sql.query(`${instruccionSQL} "${parametros}" `);
    // const result = await sql.query(`combo_tasas_ivas @lOtros=0, @lSolo_Activas=0`);
    // const result = await sql.query(`$instruccionSQL  @lOtros=0, @lSolo_Activas=0`);
    const result = await sql.query(`${instruccionSQL}  ${stringParametros}`);

    console.log(typeof result);

    res.status(200).json(result.recordsets);
  } catch (error) {
    console.error("Error al intentar obtener lista dinamica", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/consulta", async (req, res) => {
  // const { Consulta, Otros, Solo_Activas } = req.body;
  console.log(req.body);
  console.log(req.body.Procedimiento);
  let procedimiento = req.body.Procedimiento;
  let parametros = req.body.Parametros;

  //   for (let clave in req.body.Parametros) {
  //   console.log(req.body.Parametro[clave]);
  // }

  let parametrosConcatenados = "";

  // for (let valor of Object.values(req.body.Parametros)) {
  //   console.log(valor);
  //   parametrosConcatenados += valor + ',';
  // }

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
  //   return res.status(400).json({ error: 'Faltan parámetros requeridos' });
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

app.post("/abcde", async (req, res) => {
  const { nombre, codigo } = req.body; 
  if (!nombre || !codigo) {
    return res.status(400).json({ error: "Faltan campos requeridos" });
  }
  try {
    await sql.connect(sqlConfig);
    await sql.query` (${nombre}, ${codigo})`;
    res.json({ message: "" });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ error: "Error al insertar en la base de datos: " + err.message });
  }
});




//Servidor escuchando en el puerto 3001
app.listen(3001, () => {
  console.log("listening on port 3001");
});
