// SQLite access for the JavaScript side.
//
// Each organization has its own `taskjinn.sqlite` inside its folder. JavaScript sends SQL
// with `?` placeholders and a list of values; rows come back as JSON objects.
// The tables themselves are defined in ../app/js/schema.js.

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::path::Path;

const DATABASE_FILE: &str = "taskjinn.sqlite";

fn open(folder: &str) -> Result<Connection, String> {
    let connection = Connection::open(Path::new(folder).join(DATABASE_FILE)).map_err(|e| e.to_string())?;
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| e.to_string())?;
    Ok(connection)
}

/// JSON value from JavaScript → SQLite value.
fn to_sql(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().unwrap_or(0.0)),
        },
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

/// SQLite value → JSON value for JavaScript.
fn to_json(value: ValueRef) -> Value {
    match value {
        ValueRef::Null | ValueRef::Blob(_) => Value::Null,
        ValueRef::Integer(n) => Value::from(n),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
    }
}

/// Runs a SELECT (or a PRAGMA that returns rows) and returns all rows.
#[tauri::command]
pub fn db_query(folder: String, sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    let connection = open(&folder)?;
    let mut statement = connection.prepare(&sql).map_err(|e| e.to_string())?;
    let columns: Vec<String> = statement.column_names().iter().map(|name| name.to_string()).collect();

    let mut rows = statement
        .query(params_from_iter(params.iter().map(to_sql)))
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut object = Map::new();
        for (index, column) in columns.iter().enumerate() {
            let value = row.get_ref(index).map_err(|e| e.to_string())?;
            object.insert(column.clone(), to_json(value));
        }
        result.push(object);
    }
    Ok(result)
}

#[derive(Deserialize)]
pub struct Statement {
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
}

/// Runs several changes (INSERT, UPDATE, DELETE, CREATE...) so that either all are saved or none.
#[tauri::command]
pub fn db_execute(folder: String, statements: Vec<Statement>) -> Result<(), String> {
    let mut connection = open(&folder)?;
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    for statement in &statements {
        transaction
            .execute(&statement.sql, params_from_iter(statement.params.iter().map(to_sql)))
            .map_err(|e| format!("{} (in: {})", e, statement.sql))?;
    }
    transaction.commit().map_err(|e| e.to_string())
}
