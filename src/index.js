import template from '@babel/template';

function defineBinaryPrimitives(binaryPrefix) {
    return template(`const __binary__primitives = {
        '${binaryPrefix}.+'(a, b) { return a + b },
        '${binaryPrefix}.-'(a, b) { return a - b },
        '${binaryPrefix}.*'(a, b) { return a * b },
        '${binaryPrefix}./'(a, b) { return a / b },
        '${binaryPrefix}.%'(a, b) { return a / b },
        '${binaryPrefix}.^'(a, b) { return a ^ b },
        '${binaryPrefix}.|'(a, b) { return a | b },
        '${binaryPrefix}.&'(a, b) { return a & b },
        '${binaryPrefix}.||'(a, b) { return a || b },
        '${binaryPrefix}.&&'(a, b) { return a && b },
        '${binaryPrefix}.=='(a, b) { return a == b },
        '${binaryPrefix}.!='(a, b) { return a != b },
        '${binaryPrefix}.==='(a, b) { return a === b },
        '${binaryPrefix}.!=='(a, b) { return a !== b },
        '${binaryPrefix}.>'(a, b) { return a > b },
        '${binaryPrefix}.>='(a, b) { return a >= b },
        '${binaryPrefix}.<'(a, b) { return a < b },
        '${binaryPrefix}.<='(a, b) { return a <= b },
        '${binaryPrefix}.>>'(a, b) { return a >> b },
        '${binaryPrefix}.<<'(a, b) { return a << b },
        '${binaryPrefix}.**'(a, b) { return a ** b },
        '${binaryPrefix}.instanceof'(a, b) { return a instanceof b },
        '${binaryPrefix}.in'(a, b) { return a in b }
    }`);
}

function defineUnaryPrimitives(unaryPrefix) {
    return template(`const __unary__primitives = {
        '${unaryPrefix}.+'(a) { return +a },
        '${unaryPrefix}.-'(a) { return -a },
        '${unaryPrefix}.++'(a) { return ++a },
        '${unaryPrefix}.--'(a) { return --a },
        '${unaryPrefix}.~'(a) { return ~a },
        '${unaryPrefix}.!'(a) { return !a },
        '${unaryPrefix}.typeof'(a) { return typeof a },
        '${unaryPrefix}.void'(a) { return void a }
    }`);
}

function bop(primitivesId) {
    const buildCall = template(`
        function _bop(LEFT, RIGHT, OPERATOR) {
            if (LEFT !== null && LEFT !== void 0 && LEFT.constructor[OPERATOR]) {
                return LEFT.constructor[OPERATOR](LEFT, RIGHT);
            }
    
            if (RIGHT !== null && RIGHT !== void 0 && RIGHT.constructor[OPERATOR]) {
                return RIGHT.constructor[OPERATOR](LEFT, RIGHT);
            }
            
            return ${primitivesId}[OPERATOR](LEFT, RIGHT);
        }
    `);
    return buildCall;
}


function uop(primitivesId) {
    const buildCall = template(`
        function _uop(ARG, OPERATOR) {
            if (ARG !== null && ARG !== void 0 && ARG.constructor[OPERATOR]) {
                return ARG.constructor[OPERATOR](ARG);
            }
            return ${primitivesId}[OPERATOR](ARG);
        }
    `);
    return buildCall;
}

export default function({types: t}) {
    return {
        visitor: {
            Program(path, state) {
                const prefixes = state.opts.prefixes;
                let unary = 'unary';
                let binary = 'binary';
                if (prefixes) {
                    unary = prefixes.unary || unary;
                    binary = prefixes.binary || binary;
                }
    
                this.unaryPrefix = unary;
                this.binaryPrefix = binary;

                const binaryPrimitives = defineBinaryPrimitives(this.binaryPrefix)();
                const unaryPrimitives = defineUnaryPrimitives(this.unaryPrefix)();
                
                binaryPrimitives.declarations[0].id = path.scope.generateUidIdentifierBasedOnNode(binaryPrimitives.declarations[0].id);
                unaryPrimitives.declarations[0].id = path.scope.generateUidIdentifierBasedOnNode(unaryPrimitives.declarations[0].id);

                this.bop = bop(binaryPrimitives.declarations[0].id.name)({
                    LEFT: path.scope.generateUidIdentifier('left'),
                    RIGHT: path.scope.generateUidIdentifier('right'),
                    OPERATOR: path.scope.generateUidIdentifier('operator')
                });

                this.uop = uop(unaryPrimitives.declarations[0].id.name)({
                    ARG: path.scope.generateUidIdentifier('arg'),
                    OPERATOR: path.scope.generateUidIdentifier('operator')
                });
                
                this.bop.id = path.scope.generateUidIdentifierBasedOnNode(this.bop.id);
                this.uop.id = path.scope.generateUidIdentifierBasedOnNode(this.uop.id);

                path.unshiftContainer('body', binaryPrimitives);
                path.unshiftContainer('body', unaryPrimitives);

                path.unshiftContainer('body', this.bop);
                path.unshiftContainer('body', this.uop);
            },

            FunctionDeclaration(path) {
                if (path.node.id.name === this.bop.id.name ||
                    path.node.id.name === this.uop.id.name) {
                    path.skip();
                }
            },

            'BinaryExpression|LogicalExpression'(path) {
                if (path.node.loc == null) {
                    path.skip();
                    return;
                }

                path.replaceWith(t.callExpression(this.bop.id, [path.node.left, path.node.right, t.stringLiteral(`${this.binaryPrefix}.${path.node.operator}`)]));
            },
            
            UnaryExpression(path) {
                if (path.node.loc == null) {
                    path.skip();
                    return;
                }

                const op = t.stringLiteral(`${this.unaryPrefix}.${path.node.operator}`);
                path.replaceWith(t.callExpression(this.uop.id, [path.node.argument, op]));
            },

            UpdateExpression(path) {
                if (path.node.loc == null) {
                    path.skip();
                    return;
                }

                const op = t.stringLiteral(`${this.unaryPrefix}.${path.node.operator}`);
                path.replaceWith(t.assignmentExpression('=', path.node.argument, t.callExpression(this.uop.id, [path.node.argument, op])));
            },

            AssignmentExpression(path) {
                if (path.node.loc == null) {
                    path.skip();
                    return;
                }

                const assignmentOperstors = new Set(['+=', '-=', '*=', '/=', '%=', '|=', '&=', '^=', '>>=', '<<=', '**=']);
                const operator = path.node.operator;
                if (!assignmentOperstors.has(operator)) {
                    return;
                }
                
                const correspondingOperator = operator.substring(0, operator.length - 1);
                const op = t.stringLiteral(`${this.binaryPrefix}.${correspondingOperator}`);
                const bopCall = t.callExpression(this.bop.id, [path.node.left, path.node.right, op]);
                path.replaceWith(t.assignmentExpression('=', path.node.left, bopCall));
            }
        }
    };
}
