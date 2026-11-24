// Writes an Excel (.xlsx) file described by JavaScript.
//
// JavaScript decides everything about the layout (see ../app/js/reports.js). This file only turns
// that description into a spreadsheet with rust_xlsxwriter, so it knows nothing about
// timesheets or invoices.

use rust_xlsxwriter::{Color, ExcelDateTime, Format, FormatAlign, FormatBorder, Formula, Image, Workbook};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    name: String,
    #[serde(default)]
    columns: Vec<Column>,
    #[serde(default)]
    rows: Vec<RowHeight>,
    #[serde(default)]
    styles: HashMap<String, Style>,
    #[serde(default)]
    cells: Vec<Cell>,
    #[serde(default)]
    merges: Vec<Merge>,
    #[serde(default)]
    images: Vec<Picture>,
    #[serde(default)]
    hide_gridlines: bool,
}

#[derive(Deserialize)]
pub struct Column {
    col: u16,
    width: f64,
}

#[derive(Deserialize)]
pub struct RowHeight {
    row: u32,
    height: f64,
}

/// How a cell looks. Colours are "#RRGGBB".
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    bold: Option<bool>,
    italic: Option<bool>,
    size: Option<f64>,
    font: Option<String>,
    color: Option<String>,
    background: Option<String>,
    /// "left", "center" or "right"
    align: Option<String>,
    wrap: Option<bool>,
    /// e.g. "0.00", "#,##0.00", "dd/mm/yyyy"
    number_format: Option<String>,
    border: Option<bool>,
    border_top: Option<bool>,
    border_bottom: Option<bool>,
    border_color: Option<String>,
}

/// One cell. Give exactly one of text, number, date ("YYYY-MM-DD") or formula.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    row: u32,
    col: u16,
    text: Option<String>,
    number: Option<f64>,
    date: Option<String>,
    formula: Option<String>,
    /// The value shown before the spreadsheet recalculates a formula.
    result: Option<String>,
    style: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Merge {
    first_row: u32,
    first_col: u16,
    last_row: u32,
    last_col: u16,
    #[serde(default)]
    text: String,
    style: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Picture {
    row: u32,
    col: u16,
    path: String,
    width: f64,
    height: f64,
    #[serde(default)]
    x_offset: u32,
    #[serde(default)]
    y_offset: u32,
}

fn color(hex: &str) -> Color {
    Color::RGB(u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap_or(0))
}

fn make_format(style: &Style) -> Format {
    let mut format = Format::new().set_align(FormatAlign::VerticalCenter);
    if style.bold == Some(true) { format = format.set_bold(); }
    if style.italic == Some(true) { format = format.set_italic(); }
    if let Some(size) = style.size { format = format.set_font_size(size); }
    if let Some(font) = &style.font { format = format.set_font_name(font); }
    if let Some(hex) = &style.color { format = format.set_font_color(color(hex)); }
    if let Some(hex) = &style.background { format = format.set_background_color(color(hex)); }
    if style.wrap == Some(true) { format = format.set_text_wrap(); }
    if let Some(number_format) = &style.number_format { format = format.set_num_format(number_format); }
    format = match style.align.as_deref() {
        Some("center") => format.set_align(FormatAlign::Center),
        Some("right") => format.set_align(FormatAlign::Right),
        Some("left") => format.set_align(FormatAlign::Left),
        _ => format,
    };
    // Borders: only the sides that are asked for get a line (and the colour).
    let border_color = style.border_color.as_deref().map(color).unwrap_or(Color::Black);
    if style.border == Some(true) {
        format = format.set_border(FormatBorder::Thin).set_border_color(border_color);
    }
    if style.border_top == Some(true) {
        format = format.set_border_top(FormatBorder::Thin).set_border_top_color(border_color);
    }
    if style.border_bottom == Some(true) {
        format = format.set_border_bottom(FormatBorder::Thin).set_border_bottom_color(border_color);
    }
    format
}

fn parse_date(text: &str) -> Result<ExcelDateTime, String> {
    let parts: Vec<u32> = text.split('-').filter_map(|p| p.parse().ok()).collect();
    if parts.len() != 3 {
        return Err(format!("Bad date: {text}"));
    }
    ExcelDateTime::from_ymd(parts[0] as u16, parts[1] as u8, parts[2] as u8).map_err(|e| e.to_string())
}

/// Saves the described sheet as an .xlsx file at `path`.
#[tauri::command]
pub fn write_xlsx(path: String, sheet: Sheet) -> Result<(), String> {
    let error = |e: rust_xlsxwriter::XlsxError| e.to_string();
    let formats: HashMap<&String, Format> = sheet.styles.iter().map(|(name, style)| (name, make_format(style))).collect();
    let plain = Format::new();
    let format_for = |name: &Option<String>| name.as_ref().and_then(|n| formats.get(n)).unwrap_or(&plain);

    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet.set_name(&sheet.name).map_err(error)?;
    worksheet.set_paper_size(9); // A4
    worksheet.set_print_fit_to_pages(1, 0);
    if sheet.hide_gridlines {
        worksheet.set_screen_gridlines(false);
    }

    for column in &sheet.columns {
        worksheet.set_column_width(column.col, column.width).map_err(error)?;
    }
    for row in &sheet.rows {
        worksheet.set_row_height(row.row, row.height).map_err(error)?;
    }
    for merge in &sheet.merges {
        worksheet
            .merge_range(merge.first_row, merge.first_col, merge.last_row, merge.last_col, &merge.text, format_for(&merge.style))
            .map_err(error)?;
    }
    for cell in &sheet.cells {
        let format = format_for(&cell.style);
        if let Some(text) = &cell.text {
            worksheet.write_string_with_format(cell.row, cell.col, text, format).map_err(error)?;
        } else if let Some(number) = cell.number {
            worksheet.write_number_with_format(cell.row, cell.col, number, format).map_err(error)?;
        } else if let Some(date) = &cell.date {
            worksheet.write_datetime_with_format(cell.row, cell.col, parse_date(date)?, format).map_err(error)?;
        } else if let Some(formula) = &cell.formula {
            let mut formula = Formula::new(formula);
            if let Some(result) = &cell.result {
                formula = formula.set_result(result);
            }
            worksheet.write_formula_with_format(cell.row, cell.col, formula, format).map_err(error)?;
        } else {
            worksheet.write_blank(cell.row, cell.col, format).map_err(error)?;
        }
    }
    for picture in &sheet.images {
        let image = Image::new(&picture.path).map_err(error)?.set_scale_to_size(picture.width, picture.height, true);
        worksheet
            .insert_image_with_offset(picture.row, picture.col, &image, picture.x_offset, picture.y_offset)
            .map_err(error)?;
    }

    workbook.save(&path).map_err(error)
}
