use std::{io::{Read,Write},path::{Path,PathBuf},time::{SystemTime,UNIX_EPOCH}};
use serde::{Serialize,Deserialize};
const LIMIT:usize=16;
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct StoredRecent {pub path:PathBuf,pub name:String,pub last_opened:u64}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct RecentProject {pub id:String,pub path:String,pub name:String,pub file_name:String,pub last_opened:u64,pub available:bool,pub source:&'static str}
pub struct RecentRegistry(pub PathBuf);
impl RecentRegistry {
 fn load(&self)->Result<Vec<StoredRecent>,String>{
  let file=match std::fs::File::open(&self.0){Ok(f)=>f,Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(vec![]),Err(e)=>return Err(e.to_string())};
  let mut text=String::new();file.take(256001).read_to_string(&mut text).map_err(|e|e.to_string())?;
  if text.len()>256000{return Err("Список недавних проектов слишком велик.".into())}
  let entries:Vec<StoredRecent>=serde_json::from_str(&text).map_err(|_|"Список недавних проектов повреждён.")?;
  if entries.len()>LIMIT || entries.iter().any(|e| !e.path.is_absolute() || e.name.is_empty() || e.name.chars().count()>200 || e.path.as_os_str().len()>4096){return Err("Некорректный список недавних проектов.".into())}
  Ok(entries)
 }
 fn write(&self,entries:&[StoredRecent])->Result<(),String>{
  let parent=self.0.parent().ok_or("Не найдена папка данных приложения.")?;std::fs::create_dir_all(parent).map_err(|e|e.to_string())?;
  let text=serde_json::to_vec(entries).map_err(|e|e.to_string())?;
  if text.len()>256000{return Err("Список недавних проектов слишком велик.".into())}
  let mut file=tempfile::NamedTempFile::new_in(parent).map_err(|e|e.to_string())?;file.write_all(&text).map_err(|e|e.to_string())?;file.as_file().sync_all().map_err(|e|e.to_string())?;file.persist(&self.0).map_err(|e|e.to_string())?;Ok(())
 }
 pub fn record(&self,path:&Path)->Result<(),String>{
  let path=path.canonicalize().map_err(|e|e.to_string())?;
  let name=path.file_stem().unwrap_or_default().to_string_lossy().chars().take(200).collect::<String>();
  let entry=StoredRecent{path:path.clone(),name:if name.is_empty(){"Проект".into()}else{name},last_opened:SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e|e.to_string())?.as_millis() as u64};
  let mut entries=self.load()?;entries.retain(|e|e.path!=path);entries.insert(0,entry);entries.truncate(LIMIT);self.write(&entries)
 }
 pub fn list(&self)->Result<Vec<RecentProject>,String>{Ok(self.load()?.into_iter().map(|e|{let path=e.path.to_string_lossy().into_owned();RecentProject{id:path.clone(),path,name:e.name,file_name:e.path.file_name().unwrap_or_default().to_string_lossy().into_owned(),last_opened:e.last_opened,available:e.path.is_file(),source:"native"}}).collect())}
 pub fn resolve(&self,id:&str)->Result<PathBuf,String>{self.load()?.into_iter().find(|e|e.path.to_string_lossy()==id).map(|e|e.path).ok_or("Недавний проект не найден в реестре.".into())}
 pub fn remove(&self,id:&str)->Result<(),String>{let mut entries=self.load()?;entries.retain(|e|e.path.to_string_lossy()!=id);self.write(&entries)}
 pub fn clear(&self)->Result<(),String>{self.write(&[])}
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn records_real_paths_deduplicates_and_caps(){let d=tempfile::tempdir().unwrap();let r=RecentRegistry(d.path().join("recent.json"));for i in 0..18{let p=d.path().join(format!("{i}.v3d"));std::fs::write(&p,"{}").unwrap();r.record(&p).unwrap();}let p=d.path().join("17.v3d");r.record(&p).unwrap();let entries=r.list().unwrap();assert_eq!(entries.len(),16);assert_eq!(entries[0].name,"17");assert!(entries[0].available);}
 #[test]fn missing_file_stays_visible_and_can_be_removed(){let d=tempfile::tempdir().unwrap();let r=RecentRegistry(d.path().join("recent.json"));let p=d.path().join("house.v3d");std::fs::write(&p,"{}").unwrap();r.record(&p).unwrap();let id=r.list().unwrap()[0].id.clone();std::fs::remove_file(&p).unwrap();assert!(!r.list().unwrap()[0].available);assert!(r.resolve(&id).is_ok());r.remove(&id).unwrap();assert!(r.list().unwrap().is_empty());}
 #[test]fn removing_record_does_not_delete_project(){let d=tempfile::tempdir().unwrap();let r=RecentRegistry(d.path().join("recent.json"));let p=d.path().join("house.v3d");std::fs::write(&p,"{}").unwrap();r.record(&p).unwrap();let id=r.list().unwrap()[0].id.clone();r.remove(&id).unwrap();assert!(p.exists());assert!(r.list().unwrap().is_empty());}
 #[test]fn unknown_path_cannot_be_opened_as_recent(){let d=tempfile::tempdir().unwrap();let r=RecentRegistry(d.path().join("recent.json"));assert!(r.resolve("C:/unregistered.v3d").is_err());}
 #[test]fn corrupt_registry_is_not_silently_overwritten(){let d=tempfile::tempdir().unwrap();let p=d.path().join("recent.json");std::fs::write(&p,"broken").unwrap();let r=RecentRegistry(p.clone());assert!(r.list().is_err());assert_eq!(std::fs::read_to_string(&p).unwrap(),"broken");r.clear().unwrap();assert!(r.list().unwrap().is_empty());}
}
