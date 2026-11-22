import { GraphQLError, Kind, type ASTVisitor, type ValidationContext, type SelectionSetNode, type FragmentDefinitionNode } from 'graphql';

/** Count expanded fragments as well as literal AST fields, stopping before expensive expansion. */
export function complexityRule(context:ValidationContext):ASTVisitor {
  return {Document(document){
    const fragments=new Map<string,FragmentDefinitionNode>();
    for(const definition of document.definitions)if(definition.kind===Kind.FRAGMENT_DEFINITION)fragments.set(definition.name.value,definition);
    let fields=0;let exceeded=false;
    function walk(selection:SelectionSetNode,depth:number,path:Set<string>) {
      if(exceeded)return;if(depth>12){exceeded=true;return;}
      for(const item of selection.selections){if(++fields>600){exceeded=true;return;}
        if(item.kind===Kind.FIELD&&item.selectionSet)walk(item.selectionSet,depth+1,path);
        else if(item.kind===Kind.INLINE_FRAGMENT)walk(item.selectionSet,depth,path);
        else if(item.kind===Kind.FRAGMENT_SPREAD){const name=item.name.value;if(path.has(name))continue;const fragment=fragments.get(name);if(fragment)walk(fragment.selectionSet,depth,new Set([...path,name]));}
        if(exceeded)return;
      }
    }
    for(const definition of document.definitions)if(definition.kind===Kind.OPERATION_DEFINITION)walk(definition.selectionSet,1,new Set());
    if(exceeded)context.reportError(new GraphQLError('Interogarea este prea complexă.',{extensions:{code:'BAD_USER_INPUT'}}));
  }};
}
