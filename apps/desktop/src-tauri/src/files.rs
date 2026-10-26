use std::path::PathBuf;

#[derive(Default)]
pub struct FileSession {
    destination: Option<PathBuf>,
    pending: Option<(String, PathBuf)>,
    generation: u64,
}
impl FileSession {
    pub fn destination(&self) -> Option<PathBuf> { self.destination.clone() }
    pub fn offer(&mut self, path: PathBuf) -> String {
        self.generation += 1;
        let token = self.generation.to_string();
        self.pending = Some((token.clone(), path));
        token
    }
    pub fn accept(&mut self, token: &str) -> Result<(), String> {
        match &self.pending {
            Some((current, _)) if current == token => {},
            _ => return Err("Кандидат открытия устарел или отменён".into()),
        }
        self.destination = self.pending.take().map(|(_, path)| path);
        Ok(())
    }
    pub fn reject(&mut self, token: &str) {
        if self.pending.as_ref().is_some_and(|(current, _)| current == token) {
            self.pending = None;
        }
    }
    pub fn saved(&mut self, path: PathBuf) { self.destination = Some(path); }
    pub fn reset(&mut self) { self.destination = None; self.pending = None; }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejected_open_preserves_previous_destination() {
        let mut session = FileSession::default();
        session.saved("original.v3d".into());
        let token = session.offer("broken.v3d".into());
        assert_eq!(session.destination(), Some("original.v3d".into()));
        session.reject(&token);
        assert!(session.accept(&token).is_err());
        assert_eq!(session.destination(), Some("original.v3d".into()));
    }
    #[test]
    fn only_current_candidate_can_change_destination() {
        let mut session = FileSession::default();
        let old = session.offer("old.v3d".into());
        let current = session.offer("new.v3d".into());
        assert!(session.accept(&old).is_err());
        session.reject(&old);
        session.accept(&current).unwrap();
        assert_eq!(session.destination(), Some("new.v3d".into()));
    }
    #[test]
    fn reset_invalidates_pending_candidate() {
        let mut session = FileSession::default();
        let token = session.offer("old.v3d".into());
        session.reset();
        assert!(session.accept(&token).is_err());
        assert_eq!(session.destination(), None);
    }
}
